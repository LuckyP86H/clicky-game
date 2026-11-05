import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './profile';
import { computeStats, shiftDate } from './stats';

const TODAY = '2026-10-29';

const run = (over: Partial<HistoryEntry>): HistoryEntry => ({
	ts: 1000,
	date: TODAY,
	mode: 'classic',
	deckId: 'cosmic-critters',
	score: 3,
	result: 'bust',
	...over
});

/** History is stored newest-first, like recordRun produces. */
const newestFirst = (entries: HistoryEntry[]): HistoryEntry[] => [...entries].reverse();

describe('shiftDate', () => {
	it('shifts across month boundaries in both directions', () => {
		expect(shiftDate('2026-10-29', -6)).toBe('2026-10-23');
		expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
		expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
		expect(shiftDate('2026-10-29', 0)).toBe('2026-10-29');
	});
});

describe('computeStats — basics', () => {
	it('an empty history is all zeros', () => {
		const s = computeStats([], TODAY);
		expect(s).toEqual({
			totalRuns: 0,
			wins: 0,
			winRate: 0,
			averageScore: 0,
			bestScore: 0,
			runsLast7Days: 0,
			dailyStreakDays: 0,
			recentForm: [],
			trendDelta: 0
		});
	});
	it('computes totals, win rate, average and best', () => {
		const s = computeStats(
			newestFirst([
				run({ score: 4, result: 'bust' }),
				run({ score: 12, result: 'won' }),
				run({ score: 8, result: 'timeup', mode: 'timed' })
			]),
			TODAY
		);
		expect(s.totalRuns).toBe(3);
		expect(s.wins).toBe(1);
		expect(s.winRate).toBeCloseTo(1 / 3);
		expect(s.averageScore).toBe(8);
		expect(s.bestScore).toBe(12);
		expect(s.recentForm).toEqual([4, 12, 8]); // chronological
	});
	it('counts runs inside the trailing 7-day window only', () => {
		const s = computeStats(
			[
				run({ date: '2026-10-29' }),
				run({ date: '2026-10-23' }), // exactly 6 days back: inside
				run({ date: '2026-10-22' }) // 7 days back: outside
			],
			TODAY
		);
		expect(s.runsLast7Days).toBe(2);
	});
});

describe('computeStats — daily streak', () => {
	const daily = (date: string) => run({ mode: 'daily', date, deckId: `daily-${date}` });
	it('counts consecutive days ending today', () => {
		const s = computeStats(
			newestFirst([daily('2026-10-27'), daily('2026-10-28'), daily('2026-10-29')]),
			TODAY
		);
		expect(s.dailyStreakDays).toBe(3);
	});
	it('a streak ending yesterday is still alive', () => {
		const s = computeStats(newestFirst([daily('2026-10-27'), daily('2026-10-28')]), TODAY);
		expect(s.dailyStreakDays).toBe(2);
	});
	it('a gap day breaks the streak', () => {
		const s = computeStats(newestFirst([daily('2026-10-26'), daily('2026-10-29')]), TODAY);
		expect(s.dailyStreakDays).toBe(1);
	});
	it('classic runs do not count toward the daily streak', () => {
		const s = computeStats([run({ mode: 'classic' })], TODAY);
		expect(s.dailyStreakDays).toBe(0);
	});
});

describe('computeStats — trend', () => {
	it('trendDelta compares the last 5 runs with the previous 5', () => {
		const scores = [2, 2, 2, 2, 2, 6, 6, 6, 6, 6];
		const s = computeStats(newestFirst(scores.map((score) => run({ score }))), TODAY);
		expect(s.trendDelta).toBe(4);
		expect(s.recentForm).toEqual(scores);
	});
	it('trendDelta stays 0 until 10 runs exist', () => {
		const s = computeStats(newestFirst([run({ score: 1 }), run({ score: 12 })]), TODAY);
		expect(s.trendDelta).toBe(0);
	});
	it('recentForm is capped at the last 10 runs', () => {
		const many = Array.from({ length: 14 }, (_, i) => run({ score: i }));
		const s = computeStats(newestFirst(many), TODAY);
		expect(s.recentForm).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
	});
});
