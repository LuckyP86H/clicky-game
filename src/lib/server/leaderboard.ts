import { isDateString } from '../engine';
import type { Mode, ScoreEntry } from '../types';
import { type FetchFn, globalFetch } from './fetch';

/**
 * Leaderboard storage: Redis sorted sets, with an in-memory mirror.
 *
 * Why sorted sets: a leaderboard IS a sorted set — members are players'
 * results, scores are their points, and "the top 10" is one range read in
 * rank order. The two commands that matter:
 *
 *   ZADD       clicky:lb:classic  9  {"n":"Ada","s":9,"t":1730000000000}
 *   ZREVRANGE  clicky:lb:classic  0  9  WITHSCORES
 *
 * ZADD adds (or updates) a member with a score; ZREVRANGE reads the set
 * highest-first. The JSON member carries name/score/timestamp — the timestamp
 * makes every submission a distinct member, so two runs by the same player
 * can coexist on the board. Daily boards use a per-date key
 * (`clicky:lb:daily:2026-10-29`), which is what makes "today's board resets
 * tomorrow" free: tomorrow simply reads a different key.
 *
 * `InMemoryLeaderboard` mirrors exactly these semantics with a Map, so the
 * game (and the tests) behave identically with or without Redis configured.
 */

export interface LeaderboardStore {
	readonly kind: 'redis' | 'memory';
	add(entry: ScoreEntry): Promise<void>;
	top(mode: Mode, n: number, date?: string): Promise<ScoreEntry[]>;
}

export function leaderboardKey(mode: Mode, date?: string): string {
	return mode === 'daily' ? `clicky:lb:daily:${date ?? ''}` : `clicky:lb:${mode}`;
}

function memberOf(entry: ScoreEntry): string {
	return JSON.stringify({ n: entry.name, s: entry.score, t: entry.ts });
}

function entryFromMember(member: string, score: number, mode: Mode, date?: string): ScoreEntry {
	try {
		const parsed = JSON.parse(member) as { n?: unknown; t?: unknown };
		const entry: ScoreEntry = {
			name: typeof parsed.n === 'string' ? parsed.n : 'Anonymous',
			score,
			mode,
			ts: typeof parsed.t === 'number' ? parsed.t : 0
		};
		if (date !== undefined) entry.date = date;
		return entry;
	} catch {
		const entry: ScoreEntry = { name: member, score, mode, ts: 0 };
		if (date !== undefined) entry.date = date;
		return entry;
	}
}

/* ------------------------------------------------------------------ */
/* In-memory mirror (local dev / demo / tests)                          */
/* ------------------------------------------------------------------ */

export class InMemoryLeaderboard implements LeaderboardStore {
	readonly kind = 'memory' as const;
	/** key → (member → score): the same shape a Redis sorted set keeps. */
	private sets = new Map<string, Map<string, number>>();

	async add(entry: ScoreEntry): Promise<void> {
		const key = leaderboardKey(entry.mode, entry.date);
		let set = this.sets.get(key);
		if (!set) {
			set = new Map();
			this.sets.set(key, set);
		}
		set.set(memberOf(entry), entry.score); // ZADD semantics: same member ⇒ score replaced
	}

	async top(mode: Mode, n: number, date?: string): Promise<ScoreEntry[]> {
		const set = this.sets.get(leaderboardKey(mode, date));
		if (!set) return [];
		// ZREVRANGE semantics, exactly: score descending, and equal scores in
		// reverse-lexicographic member order — the same order real Redis
		// returns, so the mirror never diverges from the real store.
		return [...set.entries()]
			.sort(([mA, sA], [mB, sB]) => sB - sA || (mA < mB ? 1 : mA > mB ? -1 : 0))
			.map(([member, score]) => entryFromMember(member, score, mode, date))
			.slice(0, n);
	}
}

/* ------------------------------------------------------------------ */
/* Upstash Redis (REST)                                                 */
/* ------------------------------------------------------------------ */

export interface UpstashConfig {
	url: string;
	token: string;
}

export class UpstashLeaderboard implements LeaderboardStore {
	readonly kind = 'redis' as const;
	private base: string;
	private token: string;
	private fetchFn: FetchFn;

	constructor(config: UpstashConfig, fetchFn: FetchFn = globalFetch) {
		this.base = config.url.replace(/\/$/, '');
		this.token = config.token;
		this.fetchFn = fetchFn;
	}

	/** Run one Redis command through the Upstash REST API (JSON command array). */
	private async command(args: (string | number)[]): Promise<unknown> {
		const res = await this.fetchFn(this.base, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(args)
		});
		if (!res.ok) throw new Error(`Upstash request failed: HTTP ${res.status}`);
		const data = (await res.json()) as { result?: unknown; error?: string };
		if (data.error) throw new Error(`Upstash error: ${data.error}`);
		return data.result;
	}

	async add(entry: ScoreEntry): Promise<void> {
		// ZADD key score member
		await this.command([
			'ZADD',
			leaderboardKey(entry.mode, entry.date),
			entry.score,
			memberOf(entry)
		]);
	}

	async top(mode: Mode, n: number, date?: string): Promise<ScoreEntry[]> {
		// ZREVRANGE key 0 n-1 WITHSCORES → flat [member, score, member, score, …]
		const flat = (await this.command([
			'ZREVRANGE',
			leaderboardKey(mode, date),
			0,
			n - 1,
			'WITHSCORES'
		])) as string[];
		const entries: ScoreEntry[] = [];
		for (let i = 0; i + 1 < flat.length; i += 2) {
			entries.push(entryFromMember(flat[i] as string, Number(flat[i + 1]), mode, date));
		}
		return entries;
	}
}

/* ------------------------------------------------------------------ */
/* Selection + validation                                               */
/* ------------------------------------------------------------------ */

export interface LeaderboardEnv {
	UPSTASH_REDIS_REST_URL?: string;
	UPSTASH_REDIS_REST_TOKEN?: string;
}

let memorySingleton: InMemoryLeaderboard | undefined;

/** Redis when both env values are present, the in-memory mirror otherwise. */
export function getLeaderboard(env: LeaderboardEnv): LeaderboardStore {
	if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
		return new UpstashLeaderboard({
			url: env.UPSTASH_REDIS_REST_URL,
			token: env.UPSTASH_REDIS_REST_TOKEN
		});
	}
	memorySingleton ??= new InMemoryLeaderboard();
	return memorySingleton;
}

const MAX_NAME = 24;
const MAX_SCORE = 10_000;

/** Sanitize an untrusted score submission. Returns null when invalid. */
export function parseScoreSubmission(body: unknown): ScoreEntry | null {
	if (typeof body !== 'object' || body === null) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.name !== 'string') return null;
	// Player names are display text: strip anything that could become markup.
	const name = b.name
		.replace(/[<>&"']/g, '')
		.trim()
		.slice(0, MAX_NAME);
	if (name.length === 0) return null;
	if (typeof b.score !== 'number' || !Number.isInteger(b.score)) return null;
	if (b.score < 0 || b.score > MAX_SCORE) return null;
	if (b.mode !== 'classic' && b.mode !== 'timed' && b.mode !== 'daily') return null;
	const entry: ScoreEntry = { name, score: b.score, mode: b.mode, ts: Date.now() };
	if (b.mode === 'daily') {
		if (!isDateString(b.date)) return null;
		entry.date = b.date;
	}
	return entry;
}
