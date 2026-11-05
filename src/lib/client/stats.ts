import type { HistoryEntry } from './profile';

/**
 * Personal progress stats — the memory-training view over local run history.
 *
 * Pure functions over the recorded history plus an injected "today"
 * (YYYY-MM-DD), so every number is deterministic and unit-testable. All date
 * math is done in UTC on the date strings themselves: no wall clock, no
 * timezone drift.
 */

export interface Stats {
	totalRuns: number;
	wins: number;
	/** 0..1 — won runs / finished runs. */
	winRate: number;
	averageScore: number;
	bestScore: number;
	runsLast7Days: number;
	/** Consecutive days (ending today, or yesterday if today is unplayed) with a Daily run. */
	dailyStreakDays: number;
	/** Scores of the most recent runs, oldest → newest (for the sparkline). */
	recentForm: number[];
	/** avg(last 5 runs) − avg(previous 5 runs); 0 until 10 runs exist. */
	trendDelta: number;
}

/** Shift a YYYY-MM-DD string by whole days (UTC math, no Date/timezone traps). */
export function shiftDate(date: string, deltaDays: number): string {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const t = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86_400_000);
	const mm = `${t.getUTCMonth() + 1}`.padStart(2, '0');
	const dd = `${t.getUTCDate()}`.padStart(2, '0');
	return `${t.getUTCFullYear()}-${mm}-${dd}`;
}

function average(values: readonly number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeStats(history: readonly HistoryEntry[], today: string): Stats {
	const totalRuns = history.length;
	const wins = history.filter((h) => h.result === 'won').length;
	const scores = history.map((h) => h.score);

	const weekStart = shiftDate(today, -6);
	const runsLast7Days = history.filter((h) => h.date >= weekStart && h.date <= today).length;

	// Daily streak: walk backwards from today (or yesterday) while days have runs.
	const dailyDays = new Set(history.filter((h) => h.mode === 'daily').map((h) => h.date));
	let cursor = dailyDays.has(today) ? today : shiftDate(today, -1);
	let dailyStreakDays = 0;
	while (dailyDays.has(cursor)) {
		dailyStreakDays++;
		cursor = shiftDate(cursor, -1);
	}

	// History is stored newest-first; form/trend want chronological order.
	const chronological = [...scores].reverse();
	const recentForm = chronological.slice(-10);
	const trendDelta =
		chronological.length >= 10
			? average(chronological.slice(-5)) - average(chronological.slice(-10, -5))
			: 0;

	return {
		totalRuns,
		wins,
		winRate: totalRuns === 0 ? 0 : wins / totalRuns,
		averageScore: average(scores),
		bestScore: scores.length === 0 ? 0 : Math.max(...scores),
		runsLast7Days,
		dailyStreakDays,
		recentForm,
		trendDelta
	};
}
