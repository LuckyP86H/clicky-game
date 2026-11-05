import { hashSeed, mulberry32 } from './rng';

/**
 * Original procedurally-generated card art.
 *
 * The original game's artwork was hotlinked from a third-party site, which is
 * neither licensed nor reliable. Instead, every bundled card is an original
 * geometric "critter" drawn by this module from a seed string: the same seed
 * always draws the same critter, different seeds draw visibly different ones.
 * The output is a self-contained SVG string (no external assets, no keys).
 */

const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
	// [body, belly, accent]
	['#ff8a5c', '#ffd9c2', '#2d4059'],
	['#6bcbef', '#dff6ff', '#123c69'],
	['#95d66b', '#ecffd9', '#274e13'],
	['#f7c948', '#fff3c4', '#664d03'],
	['#c39bff', '#efe6ff', '#3c1d96'],
	['#ff6b9d', '#ffe0ec', '#5c1031'],
	['#4fd1a5', '#d9fff2', '#0b5345'],
	['#ffa94d', '#ffe8cc', '#7a3b06'],
	['#748ffc', '#e7f5ff', '#1b2a6b'],
	['#63e6be', '#e6fff7', '#087f5b']
];

const BACKDROPS = ['#0f172a', '#1e1b4b', '#082f2e', '#2b1608', '#301934', '#101c3a'];

function pick<T>(rng: () => number, items: readonly T[]): T {
	return items[Math.floor(rng() * items.length)] as T;
}

/** Render the critter for a seed as an SVG string (safe to inline: we generate it). */
export function critterSvg(seedText: string): string {
	const rng = mulberry32(hashSeed(`critter:${seedText}`));
	const [body, belly, accent] = pick(rng, PALETTES);
	const backdrop = pick(rng, BACKDROPS);
	const earStyle = Math.floor(rng() * 3); // 0 none, 1 round ears, 2 horns
	const eyeStyle = Math.floor(rng() * 3); // 0 happy arcs, 1 dots, 2 stars
	const mouthStyle = Math.floor(rng() * 3); // 0 smile, 1 o, 2 grin
	const spotCount = Math.floor(rng() * 4);
	const tilt = Math.floor(rng() * 13) - 6;

	const ears =
		earStyle === 1
			? `<circle cx="118" cy="78" r="26" fill="${body}"/><circle cx="282" cy="78" r="26" fill="${body}"/>`
			: earStyle === 2
				? `<path d="M116 84 L96 26 L152 58 Z" fill="${accent}"/><path d="M284 84 L304 26 L248 58 Z" fill="${accent}"/>`
				: '';

	const eyes =
		eyeStyle === 0
			? `<path d="M138 182 q18 -20 36 0" stroke="${accent}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M226 182 q18 -20 36 0" stroke="${accent}" stroke-width="10" fill="none" stroke-linecap="round"/>`
			: eyeStyle === 1
				? `<circle cx="156" cy="178" r="13" fill="${accent}"/><circle cx="244" cy="178" r="13" fill="${accent}"/>`
				: `<path d="M156 162 l7 14 15 2 -11 11 3 15 -14 -8 -14 8 3 -15 -11 -11 15 -2 Z" fill="${accent}"/><path d="M244 162 l7 14 15 2 -11 11 3 15 -14 -8 -14 8 3 -15 -11 -11 15 -2 Z" fill="${accent}"/>`;

	const mouth =
		mouthStyle === 0
			? `<path d="M168 232 q32 28 64 0" stroke="${accent}" stroke-width="10" fill="none" stroke-linecap="round"/>`
			: mouthStyle === 1
				? `<circle cx="200" cy="238" r="14" fill="${accent}"/>`
				: `<path d="M164 224 h72 v10 a36 22 0 0 1 -72 0 Z" fill="${accent}"/>`;

	let spots = '';
	for (let i = 0; i < spotCount; i++) {
		const cx = 110 + Math.floor(rng() * 180);
		const cy = 120 + Math.floor(rng() * 150);
		const r = 6 + Math.floor(rng() * 10);
		spots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${belly}" opacity="0.55"/>`;
	}

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-hidden="true">` +
		`<rect width="400" height="400" fill="${backdrop}"/>` +
		`<g transform="rotate(${tilt} 200 210)">${ears}` +
		`<ellipse cx="200" cy="215" rx="118" ry="108" fill="${body}"/>` +
		`<ellipse cx="200" cy="262" rx="66" ry="52" fill="${belly}"/>${spots}${eyes}${mouth}</g></svg>`
	);
}
