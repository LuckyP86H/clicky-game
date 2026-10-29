import { describe, expect, it } from 'vitest';
import { DAILY_POOL } from './decks';
import {
	applyClick,
	applyTimeout,
	createDailyRun,
	createRun,
	DAILY_DECK_SIZE,
	dailyDeck,
	localDateString,
	STREAK_EVENT_EVERY,
	TIMED_DURATION_MS,
	timeLeft
} from './engine';
import type { CardDef } from './types';
import { isMode, MODES } from './types';

const CARDS: CardDef[] = Array.from({ length: 4 }, (_, i) => ({
	id: `c${i}`,
	title: `Card ${i}`,
	artSeed: `c${i}`
}));
const DECK = { id: 'test-deck', cards: CARDS };
const T0 = 1_730_000_000_000;

function classic(seed = 11) {
	return createRun({ mode: 'classic', deck: DECK, seed, now: T0 });
}

describe('createRun', () => {
	it('deals every card exactly once, score 0, playing', () => {
		const run = classic();
		expect([...run.order].sort()).toEqual(['c0', 'c1', 'c2', 'c3']);
		expect(run.score).toBe(0);
		expect(run.status).toBe('playing');
		expect(run.lastEvent?.type).toBe('start');
	});
	it('is deterministic for a fixed seed', () => {
		expect(classic(5).order).toEqual(classic(5).order);
		expect(classic(5).order).not.toEqual(classic(6).order);
	});
});

describe('applyClick — hits', () => {
	it('scores, records the click and reshuffles deterministically', () => {
		const run = classic();
		const first = run.order[0] as string;
		const next = applyClick(run, first, T0 + 1);
		expect(next.score).toBe(1);
		expect(next.clicked).toEqual([first]);
		expect(next.status).toBe('playing');
		// Same seed + same click ⇒ same resulting order, every time.
		expect(applyClick(run, first, T0 + 1).order).toEqual(next.order);
		// Input state is not mutated.
		expect(run.score).toBe(0);
		expect(run.clicked).toEqual([]);
	});
	it('emits a streak event every third hit and nearmiss at one remaining', () => {
		let run = createRun({
			mode: 'classic',
			deck: {
				id: 'd6',
				cards: [...CARDS, { id: 'c4', title: 'Card 4' }, { id: 'c5', title: 'Card 5' }]
			},
			seed: 3,
			now: T0
		});
		const ids = run.order;
		run = applyClick(run, ids[0] as string, T0);
		run = applyClick(run, ids[1] as string, T0);
		run = applyClick(run, ids[2] as string, T0);
		expect(run.lastEvent?.type).toBe('streak');
		run = applyClick(run, ids[3] as string, T0);
		run = applyClick(run, ids[4] as string, T0);
		expect(run.lastEvent?.type).toBe('nearmiss');
	});
});

describe('applyClick — the repeat guard', () => {
	it('busts the run when a card is clicked twice', () => {
		const run = classic();
		const id = run.order[0] as string;
		const afterHit = applyClick(run, id, T0 + 1);
		const afterRepeat = applyClick(afterHit, id, T0 + 2);
		expect(afterRepeat.status).toBe('bust');
		expect(afterRepeat.score).toBe(1); // the bust click does not score
		expect(afterRepeat.lastEvent?.type).toBe('bust');
	});
	it('ignores clicks after the run has ended', () => {
		const run = classic();
		const id = run.order[0] as string;
		const busted = applyClick(applyClick(run, id, T0 + 1), id, T0 + 2);
		expect(applyClick(busted, run.order[1] as string, T0 + 3)).toBe(busted);
	});
});

describe('applyClick — winning', () => {
	it('wins when every card has been clicked exactly once', () => {
		let run = classic();
		for (const id of ['c0', 'c1', 'c2', 'c3']) run = applyClick(run, id, T0 + 1);
		expect(run.status).toBe('won');
		expect(run.score).toBe(4);
		expect(run.lastEvent?.type).toBe('win');
	});
});

describe('timed mode', () => {
	it('sets a deadline and reports time left', () => {
		const run = createRun({ mode: 'timed', deck: DECK, seed: 1, now: T0 });
		expect(run.deadline).toBe(T0 + TIMED_DURATION_MS);
		expect(timeLeft(run, T0 + 10_000)).toBe(TIMED_DURATION_MS - 10_000);
	});
	it('a click after the deadline ends the run as timeup without scoring', () => {
		const run = createRun({ mode: 'timed', deck: DECK, seed: 1, now: T0 });
		const next = applyClick(run, run.order[0] as string, T0 + TIMED_DURATION_MS + 1);
		expect(next.status).toBe('timeup');
		expect(next.score).toBe(0);
	});
	it('applyTimeout only fires at/past the deadline and only in timed mode', () => {
		const timed = createRun({ mode: 'timed', deck: DECK, seed: 1, now: T0 });
		expect(applyTimeout(timed, T0 + 1)).toBe(timed);
		expect(applyTimeout(timed, T0 + TIMED_DURATION_MS + 1).status).toBe('timeup');
		const classicRun = classic();
		expect(applyTimeout(classicRun, T0 + TIMED_DURATION_MS + 1)).toBe(classicRun);
	});
});

describe('modes', () => {
	it('MODES lists the three modes and isMode guards them', () => {
		expect(STREAK_EVENT_EVERY).toBe(3);
		expect(MODES).toEqual(['classic', 'timed', 'daily']);
		expect(isMode('daily')).toBe(true);
		expect(isMode('ranked')).toBe(false);
		expect(isMode(3)).toBe(false);
	});
});

describe('daily challenge', () => {
	it('same date ⇒ same deck, same order, same shuffle sequence', () => {
		const a = createDailyRun(DAILY_POOL, '2026-10-29', T0);
		const b = createDailyRun(DAILY_POOL, '2026-10-29', T0 + 999);
		expect(a.order).toEqual(b.order);
		expect(a.seed).toBe(b.seed);
		const first = a.order[0] as string;
		expect(applyClick(a, first, T0).order).toEqual(applyClick(b, first, T0).order);
	});
	it('deals DAILY_DECK_SIZE unique cards drawn from the pool', () => {
		const { cards } = dailyDeck(DAILY_POOL, '2026-10-29');
		expect(DAILY_DECK_SIZE).toBe(12);
		expect(cards).toHaveLength(DAILY_DECK_SIZE);
		expect(new Set(cards.map((c) => c.id)).size).toBe(12);
		const poolIds = new Set(DAILY_POOL.map((c) => c.id));
		for (const c of cards) expect(poolIds.has(c.id)).toBe(true);
	});
	it('different dates deal different boards (checked over a fixed week)', () => {
		const boards = new Set(
			['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((d) =>
				dailyDeck(DAILY_POOL, d)
					.cards.map((c) => c.id)
					.join(',')
			)
		);
		expect(boards.size).toBe(5);
	});
	it('localDateString formats with zero padding', () => {
		expect(localDateString(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
		expect(localDateString(new Date(2026, 9, 29, 12, 0, 0))).toBe('2026-10-29');
	});
});
