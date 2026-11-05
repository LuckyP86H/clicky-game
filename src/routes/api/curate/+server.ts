import {
	createCandidateJudge,
	curateDeck,
	httpValidator,
	jevGate,
	OpenverseSource,
	sanitizeTheme
} from '#lib/server/curator.js';
import { readEnv } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/curate { theme } → Server-Sent Events stream of the curator loop.
 *
 * The curation loop runs for seconds (search → validate → maybe re-search),
 * so progress is streamed: each SSE `data:` line is one CurateEvent JSON and
 * the stream ends after the `done`/`error` event. The live Openverse source
 * is tried first; the generator itself falls back to a labelled demo deck
 * when live material runs short or the source fails.
 *
 * Validation is layered: license/dedupe/load checks first, then the Jev
 * judgment gate (real TypeSafe model with TYPESAFE_API_KEY, deterministic
 * demo judge without one) at a 0.70 probability bar.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response('invalid JSON', { status: 400 });
	}
	const theme = sanitizeTheme((body as Record<string, unknown>)?.theme);
	if (!theme) return new Response('a non-empty theme is required', { status: 400 });

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: unknown) =>
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
			try {
				const judge = createCandidateJudge(readEnv(platform));
				const gate = jevGate(httpValidator(), judge, theme);
				for await (const event of curateDeck(theme, {
					source: new OpenverseSource(),
					validator: gate.validator,
					judgeKind: judge.kind(),
					judgeSummary: gate.summary
				})) {
					send(event);
					if (event.type === 'done' || event.type === 'error') break;
				}
			} catch {
				send({ type: 'error', message: 'curation failed unexpectedly' });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
