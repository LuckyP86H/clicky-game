import { describe, expect, it } from 'vitest';
import {
	ACHIEVEMENTS,
	EMPTY_PROFILE,
	type HistoryEntry,
	loadProfile,
	recordRun,
	unlockedAchievements
} from './profile';

const run = (over: Partial<HistoryEntry>): HistoryEntry => ({
	ts: 1000,
	date: '2026-10-29',
	mode: 'classic',
	deckId: 'cosmic-critters',
	score: 3,
	result: 'bust',
	...over
});

describe('recordRun', () => {
	it('updates bests and newest-first history without mutating the input', () => {
		const p1 = recordRun(EMPTY_PROFILE, run({ score: 5 }));
		const p2 = recordRun(p1, run({ score: 8, mode: 'timed', ts: 2000 }));
		expect(p2.bestByMode).toEqual({ classic: 5, timed: 8 });
		expect(p2.bestStreak).toBe(8);
		expect(p2.history.map((h) => h.ts)).toEqual([2000, 1000]);
		expect(p1.history).toHaveLength(1);
	});
	it('never lowers a best', () => {
		const p = recordRun(recordRun(EMPTY_PROFILE, run({ score: 9 })), run({ score: 2, ts: 2000 }));
		expect(p.bestByMode.classic).toBe(9);
	});
});

describe('achievements', () => {
	const ids = (h: HistoryEntry[]) => unlockedAchievements(h).map((a) => a.id);
	it('the catalog has six achievements and an empty history unlocks none', () => {
		expect(ACHIEVEMENTS).toHaveLength(6);
		expect(ids([])).toEqual([]);
	});
	it('unlocks first steps and perfect memory', () => {
		expect(ids([run({})])).toContain('first-steps');
		expect(ids([run({ result: 'won', score: 12 })])).toContain('perfect-run');
	});
	it('daily devotee needs three distinct dates', () => {
		const two = [
			run({ mode: 'daily', date: '2026-10-27' }),
			run({ mode: 'daily', date: '2026-10-28' })
		];
		expect(ids(two)).not.toContain('daily-devotee');
		expect(ids([...two, run({ mode: 'daily', date: '2026-10-29' })])).toContain('daily-devotee');
	});
	it('explorer unlocks for curated decks only', () => {
		expect(ids([run({ deckId: 'curated-123' })])).toContain('explorer');
		expect(ids([run({ deckId: 'cosmic-critters' })])).not.toContain('explorer');
	});
});

describe('loadProfile', () => {
	it('survives corrupt storage', () => {
		const storage = {
			getItem: () => '{not json',
			setItem: () => undefined,
			removeItem: () => undefined,
			clear: () => undefined,
			key: () => null,
			length: 0
		} as Storage;
		expect(loadProfile(storage)).toEqual(EMPTY_PROFILE);
		expect(loadProfile(undefined)).toEqual(EMPTY_PROFILE);
	});
});
