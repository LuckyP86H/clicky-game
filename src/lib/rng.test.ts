import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, pickSeeded, shuffledOrder, shuffleWith } from './rng';

describe('hashSeed', () => {
	it('is deterministic and distinguishes inputs', () => {
		expect(hashSeed('clicky')).toBe(hashSeed('clicky'));
		expect(hashSeed('clicky')).not.toBe(hashSeed('clickz'));
	});
});

describe('mulberry32', () => {
	it('replays the same sequence for the same seed', () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
	});
	it('stays within [0, 1)', () => {
		const rng = mulberry32(7);
		for (let i = 0; i < 100; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe('shuffleWith', () => {
	it('returns a permutation without mutating the input', () => {
		const input = [1, 2, 3, 4, 5, 6, 7, 8];
		const out = shuffleWith(mulberry32(3), input);
		expect([...out].sort((x, y) => x - y)).toEqual(input);
		expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe('shuffledOrder', () => {
	it('is deterministic per (seed, step) and varies by step', () => {
		const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
		expect(shuffledOrder(ids, 99, 0)).toEqual(shuffledOrder(ids, 99, 0));
		expect(shuffledOrder(ids, 99, 0)).not.toEqual(shuffledOrder(ids, 99, 1));
	});
});

describe('pickSeeded', () => {
	it('picks a fixed subset for a fixed seed', () => {
		const pool = Array.from({ length: 18 }, (_, i) => `c${i}`);
		const picked = pickSeeded(pool, 1234, 12);
		expect(picked).toHaveLength(12);
		expect(new Set(picked).size).toBe(12);
		expect(pickSeeded(pool, 1234, 12)).toEqual(picked);
	});
});
