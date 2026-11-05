import { json } from '@sveltejs/kit';
import { readEnv } from '#lib/server/env.js';
import { type HostContext, hostComment } from '#lib/server/host.js';
import { type GameEventType, isMode } from '#lib/types.js';
import type { RequestHandler } from './$types';

const EVENT_TYPES: readonly string[] = [
	'start',
	'hit',
	'streak',
	'nearmiss',
	'bust',
	'win',
	'timeup'
];

/**
 * POST /api/comment { event, mode, score, streak, remaining, cardTitle?, deckName? }
 * → { line, adapter, judge, tone, drama } — `adapter` honestly names the voice
 * that produced the line ('demo' for the scripted host, 'gemini' /
 * 'openai-compatible' for models); `judge` names the Jev layer that picked
 * the tone ('typesafe' for the real model, 'demo' for the heuristic judge).
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	if (typeof body !== 'object' || body === null)
		return json({ error: 'invalid body' }, { status: 400 });
	const b = body as Record<string, unknown>;
	if (typeof b.event !== 'string' || !EVENT_TYPES.includes(b.event)) {
		return json({ error: 'invalid event' }, { status: 400 });
	}
	if (!isMode(b.mode)) return json({ error: 'invalid mode' }, { status: 400 });
	const num = (v: unknown) =>
		typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
	const ctx: HostContext = {
		event: b.event as GameEventType,
		mode: b.mode,
		score: num(b.score),
		streak: num(b.streak),
		remaining: num(b.remaining)
	};
	if (typeof b.cardTitle === 'string') ctx.cardTitle = b.cardTitle.slice(0, 80);
	if (typeof b.deckName === 'string') ctx.deckName = b.deckName.slice(0, 80);
	const result = await hostComment(readEnv(platform), ctx);
	return json(result);
};
