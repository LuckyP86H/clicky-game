import { describe, expect, it } from 'vitest';
import { CRITTERS, DAILY_POOL, DEFAULT_DECK, demoDeckForTheme } from './decks';
import type { DeckSource } from './types';

describe('bundled decks', () => {
	it('the default deck has 12 unique generated-art cards', () => {
		const source: DeckSource = DEFAULT_DECK.source;
		expect(source).toBe('builtin');
		expect(DEFAULT_DECK.cards).toHaveLength(12);
		expect(new Set(DEFAULT_DECK.cards.map((c) => c.id)).size).toBe(12);
		for (const card of DEFAULT_DECK.cards) {
			expect(card.artSeed).toBeTruthy();
			expect(card.imageUrl).toBeUndefined();
		}
		expect(CRITTERS).toHaveLength(12);
	});
	it('the daily pool extends the critters to 18 unique cards', () => {
		expect(DAILY_POOL).toHaveLength(18);
		expect(new Set(DAILY_POOL.map((c) => c.id)).size).toBe(18);
	});
});

describe('demoDeckForTheme', () => {
	it('matches a themed deck by keyword and labels it demo', () => {
		const deck = demoDeckForTheme('deep sea animals');
		expect(deck.source).toBe('demo');
		expect(deck.notice).toBeTruthy();
		expect(deck.cards).toHaveLength(12);
	});
	it('falls back to the critters for unmatched themes, still labelled demo', () => {
		const deck = demoDeckForTheme('quantum gardening');
		expect(deck.source).toBe('demo');
		expect(deck.cards.map((c) => c.id)).toEqual(CRITTERS.map((c) => c.id));
	});
});
