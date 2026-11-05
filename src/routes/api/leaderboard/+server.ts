import { json } from '@sveltejs/kit';
import { isDateString } from '#lib/engine.js';
import { readEnv } from '#lib/server/env.js';
import { getLeaderboard, parseScoreSubmission } from '#lib/server/leaderboard.js';
import { isMode } from '#lib/types.js';
import type { RequestHandler } from './$types';

/** GET /api/leaderboard?mode=classic|timed|daily&date=YYYY-MM-DD&n=10 */
export const GET: RequestHandler = async ({ url, platform }) => {
	const modeParam = url.searchParams.get('mode') ?? 'classic';
	if (!isMode(modeParam)) return json({ error: 'invalid mode' }, { status: 400 });
	const dateParam = url.searchParams.get('date') ?? undefined;
	if (modeParam === 'daily' && !isDateString(dateParam)) {
		return json({ error: 'daily boards require date=YYYY-MM-DD' }, { status: 400 });
	}
	const nRaw = Number(url.searchParams.get('n') ?? '10');
	const n = Number.isFinite(nRaw) ? Math.min(50, Math.max(1, Math.trunc(nRaw))) : 10;
	const store = getLeaderboard(readEnv(platform));
	const entries = await store.top(modeParam, n, dateParam);
	return json({ entries, store: store.kind, mode: modeParam, date: dateParam ?? null });
};

/** POST /api/leaderboard { name, score, mode, date? } */
export const POST: RequestHandler = async ({ request, platform }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	const entry = parseScoreSubmission(body);
	if (!entry) return json({ error: 'invalid submission' }, { status: 400 });
	const store = getLeaderboard(readEnv(platform));
	await store.add(entry);
	// Rank = position inside the top 50 after this submission (or null if lower).
	const top = await store.top(entry.mode, 50, entry.date);
	const idx = top.findIndex(
		(e) => e.ts === entry.ts && e.name === entry.name && e.score === entry.score
	);
	return json({ ok: true, store: store.kind, rank: idx >= 0 ? idx + 1 : null });
};
