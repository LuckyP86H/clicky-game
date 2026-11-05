import { demoDeckForTheme } from '../decks';
import type { CardDef, Deck, JudgeSummary } from '../types';
import { type FetchFn, globalFetch } from './fetch';
import { judgeWithFallback, typesafeKey } from './jev';

/**
 * The deck-curator agent.
 *
 * The player types a theme ("deep sea animals"); the curator builds a playable
 * 12-card deck for it. This is a small but real agent loop:
 *
 *   plan ──► search_images ──► validate_candidate (per result) ──► assemble_deck
 *              ▲   │
 *              └───┘  if too few candidates survive validation,
 *                     search again with a broadened query (bounded retries)
 *
 * Tools are plain functions with typed inputs/outputs; the loop decides what
 * to call next from what the tools returned — that decide-act-observe cycle is
 * the whole pattern, and it is streamed to the UI step by step.
 *
 *  - `OpenverseSource` — live search over api.openverse.org (no API key; the
 *    corpus is openly licensed, and license + creator are carried onto each
 *    card for attribution).
 *  - The offline fallback (in `curateDeck` itself): when the live source
 *    errors, times out, or cannot fill the deck, the deck is assembled from
 *    bundled generated art (`demoDeckForTheme` in decks.ts) and labelled
 *    `source: 'demo'` with an explicit notice. Demo output is never
 *    presented as live AI output.
 */

export interface ImageCandidate {
	id: string;
	title: string;
	imageUrl: string;
	license: string;
	attribution?: string;
}

export interface ImageSource {
	readonly name: string;
	search(query: string, limit: number): Promise<ImageCandidate[]>;
}

/** Licenses we are comfortable hot-displaying with attribution. */
const LICENSE_ALLOWLIST = new Set(['cc0', 'pdm', 'by', 'by-sa', 'by-nc', 'by-nc-sa']);

export function licenseAllowed(license: string): boolean {
	return LICENSE_ALLOWLIST.has(license.trim().toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Live source: Openverse                                               */
/* ------------------------------------------------------------------ */

export class OpenverseSource implements ImageSource {
	readonly name = 'openverse';
	private fetchFn: FetchFn;
	private timeoutMs: number;

	constructor(fetchFn: FetchFn = globalFetch, timeoutMs = 6_000) {
		this.fetchFn = fetchFn;
		this.timeoutMs = timeoutMs;
	}

	async search(query: string, limit: number): Promise<ImageCandidate[]> {
		const url = new URL('https://api.openverse.org/v1/images/');
		url.searchParams.set('q', query);
		url.searchParams.set('page_size', `${Math.min(limit, 50)}`);
		url.searchParams.set('license_type', 'all');
		url.searchParams.set('fields', 'id,title,url,license,creator,foreign_landing_url');
		const res = await this.fetchFn(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!res.ok) throw new Error(`Openverse search failed: HTTP ${res.status}`);
		const data = (await res.json()) as {
			results?: Array<{
				id?: string;
				title?: string;
				url?: string;
				license?: string;
				creator?: string;
			}>;
		};
		const candidates: ImageCandidate[] = [];
		for (const r of data.results ?? []) {
			if (!r.id || !r.url) continue;
			const candidate: ImageCandidate = {
				id: `ov-${r.id}`,
				title: (r.title ?? 'Untitled').trim() || 'Untitled',
				imageUrl: r.url,
				license: (r.license ?? '').toLowerCase()
			};
			if (r.creator) candidate.attribution = `Photo by ${r.creator} via Openverse`;
			candidates.push(candidate);
		}
		return candidates;
	}
}

/* ------------------------------------------------------------------ */
/* Validation tool                                                      */
/* ------------------------------------------------------------------ */

export interface Validator {
	/** True when the candidate may join the deck (license ok, loads, new). */
	validate(candidate: ImageCandidate, seen: Set<string>): Promise<boolean>;
}

/** Production validator: license allowlist + dedupe + the image must load. */
export function httpValidator(fetchFn: FetchFn = globalFetch, timeoutMs = 4_000): Validator {
	return {
		async validate(candidate, seen) {
			if (seen.has(candidate.id) || seen.has(candidate.imageUrl)) return false;
			if (!licenseAllowed(candidate.license)) return false;
			try {
				const res = await fetchFn(candidate.imageUrl, {
					method: 'HEAD',
					signal: AbortSignal.timeout(timeoutMs)
				});
				return res.ok;
			} catch {
				return false;
			}
		}
	};
}

/** Test/demo validator: license + dedupe only, no network. */
export const offlineValidator: Validator = {
	async validate(candidate, seen) {
		return (
			!seen.has(candidate.id) && !seen.has(candidate.imageUrl) && licenseAllowed(candidate.license)
		);
	}
};

/* ------------------------------------------------------------------ */
/* Jev judgment layer                                                   */
/* ------------------------------------------------------------------ */

/**
 * A candidate joins the deck only when Jev's calibrated probabilities clear
 * this bar on BOTH Noul questions (on-theme, family-appropriate) and the fit
 * Choice does not land on 'off-theme'. The threshold is a plain constant in
 * code — when judgments feel wrong, tune the number, not a prompt.
 */
export const JEV_ACCEPT_THRESHOLD = 0.7;

export interface CandidateJudgment {
	/** Noul: P(the image is actually about the theme). */
	relevance: number;
	/** Noul: P(the image is appropriate for a family-friendly game). */
	appropriate: number;
	/** Choice: 'perfect-fit' | 'usable' | 'off-theme'. */
	category: string;
	/** Choice confidence, 0..1. */
	confidence: number;
}

export interface CandidateJudge {
	/** Which judge answered most recently: the real model or the demo judge. */
	kind(): 'typesafe' | 'demo';
	judge(theme: string, candidate: ImageCandidate): Promise<CandidateJudgment>;
}

/**
 * Ask Jev about one candidate in a single request (all questions share the
 * same state and evaluate in parallel): two Noul gates plus a fit Choice.
 * With TYPESAFE_API_KEY set this is the real TypeSafe model; without it —
 * or if the API fails — the deterministic demo judge answers and `kind()`
 * says so.
 */
export function createCandidateJudge(
	env: Record<string, string | undefined>,
	fetchFn: FetchFn = globalFetch
): CandidateJudge {
	let lastKind: 'typesafe' | 'demo' = typesafeKey(env) ? 'typesafe' : 'demo';
	return {
		kind: () => lastKind,
		async judge(theme, candidate) {
			const { answers, judge } = await judgeWithFallback(
				env,
				{ theme, title: candidate.title, sourceUrl: candidate.imageUrl },
				{
					relevance: {
						type: 'noul',
						instructions: 'Is `title` actually about `theme`?',
						criteria: {
							true: 'The image subject clearly matches the theme',
							false: 'The image is unrelated to the theme'
						}
					},
					appropriate: {
						type: 'noul',
						instructions: 'Is `title` appropriate for a family-friendly game for all ages?'
					},
					fit: {
						type: 'choice',
						instructions: 'How well does `title` fit `theme` as a game card?',
						criteria: {
							'perfect-fit': 'A clear, on-theme subject a player will recognise',
							usable: 'Related enough to include in the deck',
							'off-theme': 'Does not belong in a deck about the theme'
						}
					}
				},
				fetchFn
			);
			lastKind = judge;
			const rel = answers.relevance;
			const app = answers.appropriate;
			const fit = answers.fit;
			return {
				relevance: rel?.type === 'noul' ? rel.noul : 0,
				appropriate: app?.type === 'noul' ? app.noul : 0,
				category: fit?.type === 'choice' ? fit.choice : 'off-theme',
				confidence: fit?.type === 'choice' ? fit.confidence : 0
			};
		}
	};
}

/**
 * Compose the judgment layer ON TOP of a base validator: cheap deterministic
 * checks (license, dedupe, image loads) run first and short-circuit; only
 * survivors cost a Jev call. Returns the composed validator plus a summary
 * of how judging went, for honest display next to the deck.
 */
export function jevGate(
	base: Validator,
	judge: CandidateJudge,
	theme: string,
	threshold: number = JEV_ACCEPT_THRESHOLD
): { validator: Validator; summary: () => JudgeSummary } {
	const stats = { judged: 0, accepted: 0, confidenceSum: 0 };
	const validator: Validator = {
		async validate(candidate, seen) {
			if (!(await base.validate(candidate, seen))) return false;
			const j = await judge.judge(theme, candidate);
			stats.judged++;
			stats.confidenceSum += j.confidence;
			const ok =
				j.relevance >= threshold && j.appropriate >= threshold && j.category !== 'off-theme';
			if (ok) stats.accepted++;
			return ok;
		}
	};
	const summary = (): JudgeSummary => ({
		kind: judge.kind(),
		judged: stats.judged,
		accepted: stats.accepted,
		meanConfidence:
			stats.judged > 0 ? Math.round((stats.confidenceSum / stats.judged) * 100) / 100 : 0
	});
	return { validator, summary };
}

/* ------------------------------------------------------------------ */
/* The agent loop                                                       */
/* ------------------------------------------------------------------ */

export type CurateEvent =
	| { type: 'plan'; theme: string; judge?: string }
	| { type: 'search'; query: string; source: string }
	| { type: 'validate'; accepted: number; rejected: number }
	| { type: 'fallback'; reason: string }
	| { type: 'done'; deck: Deck }
	| { type: 'error'; message: string };

export interface CurateOptions {
	source: ImageSource;
	validator: Validator;
	deckSize?: number;
	maxSearches?: number;
	/** Configured judgment layer name, announced in the plan event. */
	judgeKind?: string;
	/** Called as the deck is emitted; its result rides on the deck itself. */
	judgeSummary?: () => JudgeSummary;
}

export function sanitizeTheme(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// Themes are search text and display text — never markup.
	const theme = raw
		.replace(/[<>&"']/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60);
	return theme.length > 0 ? theme : null;
}

function broadenQuery(theme: string, attempt: number): string {
	if (attempt === 0) return theme;
	if (attempt === 1) return `${theme} animal`; // nudge toward photographable subjects
	return theme.split(' ')[0] ?? theme; // last resort: the single strongest word
}

/**
 * Candidates are validated in parallel batches of this size. Sequential
 * validation made the worst case 24 × (image HEAD check + Jev call) ≈ 19 s;
 * batches of 6 bound it to ~4 rounds while acceptance order and dedupe
 * semantics stay exactly what the sequential loop produced (see the design
 * review in BUILD-LOG.md).
 */
const VALIDATION_CONCURRENCY = 6;

/**
 * Run the curation loop, yielding a progress event per step and finishing
 * with exactly one `done` (deck assembled) or `error` event.
 */
export async function* curateDeck(
	theme: string,
	{ source, validator, deckSize = 12, maxSearches = 3, judgeKind, judgeSummary }: CurateOptions
): AsyncGenerator<CurateEvent> {
	yield { type: 'plan', theme, ...(judgeKind ? { judge: judgeKind } : {}) };

	const seen = new Set<string>();
	const accepted: ImageCandidate[] = [];
	let lastError: string | undefined;

	for (let attempt = 0; attempt < maxSearches && accepted.length < deckSize; attempt++) {
		const query = broadenQuery(theme, attempt);
		yield { type: 'search', query, source: source.name };
		let results: ImageCandidate[];
		try {
			results = await source.search(query, deckSize * 2);
		} catch (err) {
			lastError = err instanceof Error ? err.message : 'search failed';
			break;
		}
		// Pre-dedupe within the page (first occurrence wins — the outcome the
		// sequential loop produced) so a parallel batch never validates two
		// copies of the same card against a stale `seen` set.
		const unique: ImageCandidate[] = [];
		const pageSeen = new Set<string>();
		for (const candidate of results) {
			if (pageSeen.has(candidate.id) || pageSeen.has(candidate.imageUrl)) continue;
			pageSeen.add(candidate.id);
			pageSeen.add(candidate.imageUrl);
			unique.push(candidate);
		}
		let rejected = results.length - unique.length;
		// Validate in bounded-concurrency batches. Acceptance follows the
		// page's original order and `seen` is updated between batches, so
		// cross-page dedupe behaves exactly as it did sequentially.
		for (let i = 0; i < unique.length && accepted.length < deckSize; i += VALIDATION_CONCURRENCY) {
			const batch = unique.slice(i, i + VALIDATION_CONCURRENCY);
			const verdicts = await Promise.all(batch.map((c) => validator.validate(c, seen)));
			for (const [j, candidate] of batch.entries()) {
				if (verdicts[j]) {
					if (accepted.length < deckSize) {
						seen.add(candidate.id);
						seen.add(candidate.imageUrl);
						accepted.push(candidate);
					}
					// else: valid, but the deck filled mid-batch — the sequential
					// loop would never have reached it; not counted as rejected.
				} else {
					rejected++;
				}
			}
		}
		yield { type: 'validate', accepted: accepted.length, rejected };
	}

	if (accepted.length >= deckSize) {
		const cards: CardDef[] = accepted.slice(0, deckSize).map((c) => {
			const card: CardDef = { id: c.id, title: c.title, imageUrl: c.imageUrl, license: c.license };
			if (c.attribution) card.attribution = c.attribution;
			return card;
		});
		const deck: Deck = {
			id: `curated-${Date.now()}`,
			name: `Curated: ${theme}`,
			source: source.name === 'openverse' ? 'openverse' : 'demo',
			cards
		};
		if (judgeSummary) deck.judge = judgeSummary();
		yield { type: 'done', deck };
		return;
	}

	// Honest fallback: not enough live material (or the source failed) ⇒ demo deck.
	yield {
		type: 'fallback',
		reason: lastError ?? `only ${accepted.length} of ${deckSize} cards passed validation`
	};
	const demo = demoDeckForTheme(theme);
	if (judgeSummary) demo.judge = judgeSummary();
	yield { type: 'done', deck: demo };
}
