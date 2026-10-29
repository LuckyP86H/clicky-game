/**
 * Small deterministic random utilities.
 *
 * Everything game-related that looks "random" flows through these helpers with
 * an explicit seed, so a run — above all the Daily Challenge — is replayable
 * and testable for any fixed date/seed. Nothing here reads the wall clock.
 */

/** FNV-1a 32-bit string hash → unsigned int seed. */
export function hashSeed(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** mulberry32: tiny, fast, seedable PRNG. Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher–Yates shuffle driven by the supplied PRNG. Does not mutate the input. */
export function shuffleWith<T>(rng: () => number, input: readonly T[]): T[] {
	const out = [...input];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = out[i] as T;
		out[i] = out[j] as T;
		out[j] = tmp;
	}
	return out;
}

/** Deterministic shuffle of ids for (seed, step) — the engine's shuffle source. */
export function shuffledOrder(ids: readonly string[], seed: number, step: number): string[] {
	return shuffleWith(mulberry32((seed ^ Math.imul(step + 1, 0x9e3779b9)) >>> 0), ids);
}

/** Pick `count` items deterministically from a pool (seeded, no replacement). */
export function pickSeeded<T>(pool: readonly T[], seed: number, count: number): T[] {
	return shuffleWith(mulberry32(seed), pool).slice(0, count);
}
