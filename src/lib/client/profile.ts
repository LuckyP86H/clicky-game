import type { Mode, RunStatus } from '../types';

/**
 * Local player profile: run history, best scores, streaks, achievements.
 *
 * Everything here is pure functions over plain data — the component layer
 * reads/writes `localStorage` and passes values in, which keeps the rules
 * (what counts as an achievement, how bests update) unit-testable without a
 * browser.
 */

export interface HistoryEntry {
	ts: number;
	date: string; // local YYYY-MM-DD of the run
	mode: Mode;
	deckId: string;
	score: number;
	result: Exclude<RunStatus, 'playing'>;
}

export interface Profile {
	bestByMode: Partial<Record<Mode, number>>;
	bestStreak: number;
	history: HistoryEntry[];
}

export const EMPTY_PROFILE: Profile = { bestByMode: {}, bestStreak: 0, history: [] };

const MAX_HISTORY = 100;

export function recordRun(profile: Profile, entry: HistoryEntry): Profile {
	const bestByMode = { ...profile.bestByMode };
	if (entry.score > (bestByMode[entry.mode] ?? 0)) bestByMode[entry.mode] = entry.score;
	return {
		bestByMode,
		bestStreak: Math.max(profile.bestStreak, entry.score),
		history: [entry, ...profile.history].slice(0, MAX_HISTORY)
	};
}

/* ------------------------------------------------------------------ */
/* Achievements                                                         */
/* ------------------------------------------------------------------ */

export interface Achievement {
	id: string;
	name: string;
	detail: string;
	unlocked: (history: readonly HistoryEntry[]) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
	{
		id: 'first-steps',
		name: 'First Steps',
		detail: 'Finish your first run.',
		unlocked: (h) => h.length >= 1
	},
	{
		id: 'perfect-run',
		name: 'Perfect Memory',
		detail: 'Win a run — every card exactly once.',
		unlocked: (h) => h.some((e) => e.result === 'won')
	},
	{
		id: 'sharp-seven',
		name: 'Sharp Seven',
		detail: 'Reach a score of 7 in any run.',
		unlocked: (h) => h.some((e) => e.score >= 7)
	},
	{
		id: 'daily-devotee',
		name: 'Daily Devotee',
		detail: 'Play the Daily Challenge on 3 different days.',
		unlocked: (h) => new Set(h.filter((e) => e.mode === 'daily').map((e) => e.date)).size >= 3
	},
	{
		id: 'against-the-clock',
		name: 'Against the Clock',
		detail: 'Score 8 or more in Timed mode.',
		unlocked: (h) => h.some((e) => e.mode === 'timed' && e.score >= 8)
	},
	{
		id: 'explorer',
		name: 'Explorer',
		detail: 'Play a deck built by the curator.',
		unlocked: (h) => h.some((e) => e.deckId.startsWith('curated-') || e.deckId.startsWith('demo-'))
	}
];

export function unlockedAchievements(history: readonly HistoryEntry[]): Achievement[] {
	return ACHIEVEMENTS.filter((a) => a.unlocked(history));
}

/* ------------------------------------------------------------------ */
/* localStorage plumbing (browser side)                                 */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'clickster:profile:v1';

export function loadProfile(storage: Storage | undefined): Profile {
	if (!storage) return EMPTY_PROFILE;
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY_PROFILE;
		const parsed = JSON.parse(raw) as Profile;
		if (!parsed || !Array.isArray(parsed.history)) return EMPTY_PROFILE;
		return {
			bestByMode: parsed.bestByMode ?? {},
			bestStreak: parsed.bestStreak ?? 0,
			history: parsed.history
		};
	} catch {
		return EMPTY_PROFILE;
	}
}

export function saveProfile(storage: Storage | undefined, profile: Profile): void {
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(profile));
	} catch {
		// Storage full/blocked — the game continues without persistence.
	}
}
