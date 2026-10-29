/**
 * Jev by TypeSafe — a "System One" JUDGMENT model (docs.typesafe.ai).
 *
 * Jev does not generate text. Each call sends a `state` (string or object)
 * plus typed questions and returns calibrated, typed answers:
 *   - Choice: pick from options -> { choice, probabilities, confidence }
 *   - Score:  position on a rubric -> { score, probabilities, confidence }
 *   - Noul:   probability a statement is true -> { noul } in 0..1
 *
 * This module provides:
 *   - TypesafeJev: the real REST client (POST /v1/systemone, Bearer key),
 *     enabled by TYPESAFE_API_KEY. No key is ever hard-coded.
 *   - DemoJev: a deterministic, heuristic stand-in used when no key is set
 *     (or when the real API fails). It is ALWAYS labelled "demo" — its
 *     answers are keyword heuristics, not model judgments.
 *   - judgeWithFallback: one-call helper that tries the real model first
 *     and reports honestly which judge actually answered.
 */
import { type FetchFn, globalFetch } from './fetch';

export type JevQuestion =
	| { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
	| { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
	| { type: 'score'; instructions: string; criteria: string[] };

export type JevAnswer =
	| { type: 'noul'; noul: number }
	| { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
	| { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number };

export type JevAnswers = Record<string, JevAnswer>;

interface JevClient {
	readonly kind: 'typesafe' | 'demo';
	evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevAnswers>;
}

const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const DEFAULT_MODEL = 'jev-latest';

export class TypesafeJev implements JevClient {
	readonly kind = 'typesafe' as const;
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly model: string;
	private readonly fetchFn: FetchFn;

	constructor(opts: { apiKey: string; baseUrl?: string; model?: string; fetchFn?: FetchFn }) {
		this.apiKey = opts.apiKey;
		this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
		this.model = opts.model ?? DEFAULT_MODEL;
		this.fetchFn = opts.fetchFn ?? globalFetch;
	}

	async evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevAnswers> {
		const res = await this.fetchFn(`${this.baseUrl}/v1/systemone`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ model: this.model, state, questions })
		});
		if (!res.ok) throw new Error(`typesafe http ${res.status}`);
		const data = (await res.json()) as { answers?: Record<string, unknown> };
		if (!data.answers || typeof data.answers !== 'object') {
			throw new Error('typesafe response missing answers');
		}
		const out: JevAnswers = {};
		for (const [id, q] of Object.entries(questions)) {
			out[id] = parseAnswer(id, q, data.answers[id]);
		}
		return out;
	}
}

function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Defensive parsing: a malformed answer is an error, never a silent guess. */
function parseAnswer(id: string, q: JevQuestion, raw: unknown): JevAnswer {
	if (!raw || typeof raw !== 'object') throw new Error(`typesafe answer ${id} missing`);
	const a = raw as Record<string, unknown>;
	if (q.type === 'noul') {
		const p = num(a.noul);
		if (p === null) throw new Error(`typesafe answer ${id} missing noul`);
		return { type: 'noul', noul: Math.min(1, Math.max(0, p)) };
	}
	if (q.type === 'choice') {
		const probs: Record<string, number> = {};
		const rawProbs = (a.probabilities ?? {}) as Record<string, unknown>;
		for (const key of Object.keys(q.criteria)) {
			probs[key] = num(rawProbs[key]) ?? 0;
		}
		const choice =
			typeof a.choice === 'string' && a.choice in q.criteria
				? a.choice
				: (Object.entries(probs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '');
		return { type: 'choice', choice, probabilities: probs, confidence: num(a.confidence) ?? 0 };
	}
	const levels = q.criteria.length;
	const score = num(a.score);
	if (score === null) throw new Error(`typesafe answer ${id} missing score`);
	const probs: Record<string, number> = {};
	const rawProbs = (a.probabilities ?? {}) as Record<string, unknown>;
	for (let i = 0; i < levels; i++) probs[String(i)] = num(rawProbs[String(i)]) ?? 0;
	return {
		type: 'score',
		score: Math.min(levels - 1, Math.max(0, score)),
		probabilities: probs,
		confidence: num(a.confidence) ?? 0
	};
}

/* ------------------------------------------------------------------ */
/* DemoJev — deterministic heuristics, labelled demo everywhere.       */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
	'the',
	'and',
	'for',
	'with',
	'this',
	'that',
	'from',
	'into',
	'your',
	'you',
	'are',
	'was',
	'were',
	'has',
	'have',
	'image',
	'photo',
	'picture'
]);
const BLOCKLIST = ['gore', 'blood', 'nsfw', 'nude', 'weapon', 'gun ', 'horror', 'corpse', 'kill'];

function tokens(s: string): Set<string> {
	return new Set(
		s
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length >= 3 && !STOPWORDS.has(w))
	);
}

function stateText(state: unknown): string {
	return typeof state === 'string' ? state : JSON.stringify(state ?? '');
}

function field(state: unknown, key: string): string {
	if (state && typeof state === 'object' && key in (state as Record<string, unknown>)) {
		const v = (state as Record<string, unknown>)[key];
		return typeof v === 'string' ? v : '';
	}
	return '';
}

/** Heuristic "relevance": token overlap between a candidate title and theme. */
function relevance(state: unknown): number {
	const title = field(state, 'title');
	const theme = field(state, 'theme');
	if (title && theme) {
		const t = tokens(theme);
		if (t.size === 0) return 0.5;
		const hit = [...t].filter((w) => tokens(title).has(w)).length;
		const frac = hit / t.size;
		return frac === 0 ? 0.18 : 0.55 + 0.4 * frac;
	}
	return 0.5;
}

function appropriateness(state: unknown): number {
	const text = stateText(state).toLowerCase();
	return BLOCKLIST.some((w) => text.includes(w)) ? 0.08 : 0.96;
}

export class DemoJev implements JevClient {
	readonly kind = 'demo' as const;

	async evaluate(state: unknown, questions: Record<string, JevQuestion>): Promise<JevAnswers> {
		const out: JevAnswers = {};
		for (const [id, q] of Object.entries(questions)) {
			out[id] = this.answerOne(state, q);
		}
		return out;
	}

	private answerOne(state: unknown, q: JevQuestion): JevAnswer {
		if (q.type === 'noul') {
			const p = q.instructions.toLowerCase().includes('appropriate')
				? appropriateness(state)
				: relevance(state);
			return { type: 'noul', noul: p };
		}
		if (q.type === 'choice') {
			return this.choiceAnswer(state, q);
		}
		return this.scoreAnswer(state, q);
	}

	private choiceAnswer(state: unknown, q: Extract<JevQuestion, { type: 'choice' }>): JevAnswer {
		const options = Object.keys(q.criteria);
		const event = field(state, 'event');
		// Host tone questions: options are tones; use simple event rules.
		if (options.includes('teasing') && options.includes('dramatic')) {
			const weights: Record<string, Record<string, number>> = {
				bust: { teasing: 0.55, dramatic: 0.25, encouraging: 0.2 },
				timeup: { teasing: 0.5, dramatic: 0.3, encouraging: 0.2 },
				win: { dramatic: 0.6, encouraging: 0.25, teasing: 0.15 },
				nearmiss: { dramatic: 0.5, teasing: 0.3, encouraging: 0.2 },
				streak: { encouraging: 0.5, dramatic: 0.3, teasing: 0.2 }
			};
			const probs = weights[event] ?? { encouraging: 0.6, teasing: 0.2, dramatic: 0.2 };
			const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? options[0] ?? '';
			return { type: 'choice', choice, probabilities: probs, confidence: probs[choice] ?? 0 };
		}
		// Curator fit questions: derive from the relevance heuristic.
		const p = relevance(state);
		const perfect = p >= 0.75 ? p : p * 0.4;
		const off = p < 0.45 ? 1 - p : (1 - p) * 0.3;
		const rest = Math.max(0.02, 1 - perfect - off);
		const probs: Record<string, number> = {};
		for (const opt of options) {
			if (opt === 'perfect-fit') probs[opt] = perfect;
			else if (opt === 'off-theme') probs[opt] = off;
			else probs[opt] = rest;
		}
		const total = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
		for (const k of Object.keys(probs)) probs[k] = (probs[k] as number) / total;
		const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? options[0] ?? '';
		return { type: 'choice', choice, probabilities: probs, confidence: probs[choice] ?? 0 };
	}

	private scoreAnswer(state: unknown, q: Extract<JevQuestion, { type: 'score' }>): JevAnswer {
		const levels = q.criteria.length;
		const s = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
		const streak = typeof s.streak === 'number' ? s.streak : 0;
		const remaining = typeof s.remaining === 'number' ? s.remaining : 99;
		const event = field(state, 'event');
		let drama = 0.18 + streak * 0.07 + (remaining <= 3 ? 0.38 : remaining <= 6 ? 0.18 : 0);
		if (event === 'win' || event === 'bust') drama = Math.max(drama, 0.85);
		if (event === 'nearmiss') drama = Math.max(drama, 0.7);
		drama = Math.min(0.97, drama);
		const score = drama * (levels - 1);
		const probs: Record<string, number> = {};
		for (let i = 0; i < levels; i++) {
			probs[String(i)] = Math.max(0.02, 1 - Math.abs(i - score) / levels);
		}
		const total = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
		for (const k of Object.keys(probs)) probs[k] = (probs[k] as number) / total;
		return { type: 'score', score, probabilities: probs, confidence: 0.6 };
	}
}

/* ------------------------------------------------------------------ */
/* Selection + fallback                                                */
/* ------------------------------------------------------------------ */

export function typesafeKey(env: Record<string, string | undefined>): string | undefined {
	const k = env.TYPESAFE_API_KEY;
	return k && k.trim() !== '' ? k : undefined;
}

export interface JudgedResult {
	answers: JevAnswers;
	/** Which judge ACTUALLY answered: 'typesafe' or 'demo'. */
	judge: 'typesafe' | 'demo';
}

/**
 * Ask Jev (real when TYPESAFE_API_KEY is set), falling back to the demo
 * judge on ANY failure — missing key, HTTP error, malformed response.
 * The returned `judge` always names the judge that produced the answers.
 */
export async function judgeWithFallback(
	env: Record<string, string | undefined>,
	state: unknown,
	questions: Record<string, JevQuestion>,
	fetchFn: FetchFn = globalFetch
): Promise<JudgedResult> {
	const key = typesafeKey(env);
	if (key) {
		try {
			const client = new TypesafeJev({
				apiKey: key,
				fetchFn,
				...(env.TYPESAFE_BASE_URL ? { baseUrl: env.TYPESAFE_BASE_URL } : {}),
				...(env.TYPESAFE_MODEL ? { model: env.TYPESAFE_MODEL } : {})
			});
			return { answers: await client.evaluate(state, questions), judge: 'typesafe' };
		} catch {
			// fall through to the demo judge — labelled as such by the caller
		}
	}
	const demo = new DemoJev();
	return { answers: await demo.evaluate(state, questions), judge: 'demo' };
}
