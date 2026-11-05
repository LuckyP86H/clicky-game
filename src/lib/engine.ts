import { hashSeed, pickSeeded, shuffledOrder } from './rng';
import type { CardDef, GameEvent, Mode, RunState } from './types';

/**
 * The game engine: pure functions over an explicit run state.
 *
 * Rules (all modes): click a card you have not clicked yet → score +1 and the
 * board shuffles; click a card twice → the run busts; click every card exactly
 * once → the run is won. Timed mode adds a deadline: when it passes, the run
 * ends as `timeup` with whatever score was reached.
 *
 * Determinism: the shuffle after click n is `shuffledOrder(ids, seed, n)` — a
 * pure function of the run seed and the click count. A run can therefore be
 * replayed exactly, and the Daily Challenge (whose seed is derived from the
 * date) deals the same sequence of boards to everyone. Tests inject fixed
 * seeds/dates/timestamps; nothing in this module reads the clock or
 * Math.random().
 */

export const TIMED_DURATION_MS = 60_000;
export const STREAK_EVENT_EVERY = 3;

export interface CreateRunOptions {
	mode: Mode;
	deck: { id: string; cards: CardDef[] };
	seed: number;
	now: number;
}

export function createRun({ mode, deck, seed, now }: CreateRunOptions): RunState {
	const ids = deck.cards.map((c) => c.id);
	const state: RunState = {
		mode,
		deckId: deck.id,
		seed,
		order: shuffledOrder(ids, seed, 0),
		clicked: [],
		score: 0,
		status: 'playing',
		clicks: 0,
		startedAt: now,
		lastEvent: null
	};
	if (mode === 'timed') state.deadline = now + TIMED_DURATION_MS;
	state.lastEvent = {
		type: 'start',
		score: 0,
		streak: 0,
		remaining: ids.length
	};
	return state;
}

/** Apply one click. Returns a NEW state (the input is not mutated). */
export function applyClick(state: RunState, cardId: string, now: number): RunState {
	if (state.status !== 'playing') return state;

	if (state.mode === 'timed' && state.deadline !== undefined && now > state.deadline) {
		return finishWith(state, 'timeup', now);
	}

	const total = state.order.length;
	const clicks = state.clicks + 1;

	// The core guard: a repeat click busts the run.
	if (state.clicked.includes(cardId)) {
		const event: GameEvent = {
			type: 'bust',
			cardId,
			score: state.score,
			streak: state.score,
			remaining: total - state.clicked.length
		};
		return { ...state, clicks, status: 'bust', lastEvent: event };
	}

	const clicked = [...state.clicked, cardId];
	const score = clicked.length;
	const remaining = total - score;

	if (remaining === 0) {
		const event: GameEvent = {
			type: 'win',
			cardId,
			score,
			streak: score,
			remaining: 0
		};
		return { ...state, clicks, clicked, score, status: 'won', lastEvent: event };
	}

	const isNearMiss = remaining === 1;
	const isStreak = score % STREAK_EVENT_EVERY === 0;
	const event: GameEvent = {
		type: isNearMiss ? 'nearmiss' : isStreak ? 'streak' : 'hit',
		cardId,
		score,
		streak: score,
		remaining
	};
	return {
		...state,
		clicks,
		clicked,
		score,
		order: shuffledOrder(state.order, state.seed, clicks),
		lastEvent: event
	};
}

/** End a timed run because the clock ran out. No-op for other modes/states. */
export function applyTimeout(state: RunState, now: number): RunState {
	if (state.status !== 'playing' || state.mode !== 'timed') return state;
	if (state.deadline === undefined || now <= state.deadline) return state;
	return finishWith(state, 'timeup', now);
}

function finishWith(state: RunState, status: 'timeup', _now: number): RunState {
	const event: GameEvent = {
		type: 'timeup',
		score: state.score,
		streak: state.score,
		remaining: state.order.length - state.clicked.length
	};
	return { ...state, status, lastEvent: event };
}

/** Milliseconds left in a timed run (0 when not timed or already over). */
export function timeLeft(state: RunState, now: number): number {
	if (state.mode !== 'timed' || state.deadline === undefined) return 0;
	return Math.max(0, state.deadline - now);
}

/* ------------------------------------------------------------------ */
/* Daily Challenge                                                      */
/* ------------------------------------------------------------------ */

export const DAILY_DECK_SIZE = 12;

/** Local-calendar date string, e.g. "2026-10-29". The one place dates enter. */
export function localDateString(d: Date): string {
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

export function isDateString(value: unknown): value is string {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The daily board: `DAILY_DECK_SIZE` cards picked deterministically from the
 * pool by the date seed, plus the run seed itself. Same date ⇒ same deck,
 * same order, same shuffle sequence — for every player.
 */
export function dailyDeck(
	pool: readonly CardDef[],
	date: string
): { seed: number; cards: CardDef[] } {
	const seed = hashSeed(`clicky-daily:${date}`);
	return { seed, cards: pickSeeded(pool, seed, DAILY_DECK_SIZE) };
}

export function createDailyRun(pool: readonly CardDef[], date: string, now: number): RunState {
	const { seed, cards } = dailyDeck(pool, date);
	return createRun({ mode: 'daily', deck: { id: `daily-${date}`, cards }, seed, now });
}
