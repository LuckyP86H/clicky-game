import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostContext } from './host';
import {
	GeminiHost,
	getHost,
	hostComment,
	judgeHostMoment,
	OpenAICompatibleHost,
	ScriptedHost,
	sanitizeLine
} from './host';

const CTX: HostContext = { event: 'win', mode: 'classic', score: 12, streak: 12, remaining: 0 };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ScriptedHost', () => {
	it('returns a non-empty line for every event type', async () => {
		const host = new ScriptedHost();
		for (const event of ['start', 'hit', 'streak', 'nearmiss', 'bust', 'win', 'timeup'] as const) {
			const line = await host.comment({ ...CTX, event });
			expect(line.length).toBeGreaterThan(0);
		}
	});
	it('is deterministic for the same context', async () => {
		const host = new ScriptedHost();
		expect(await host.comment(CTX)).toBe(await host.comment(CTX));
	});
});

describe('sanitizeLine', () => {
	it('strips markup, collapses whitespace and caps length', () => {
		expect(sanitizeLine('  <b>Great</b>   run! ')).toBe('Great run!');
		expect(sanitizeLine('x'.repeat(300))).toHaveLength(140);
	});
});

describe('getHost', () => {
	it('prefers Gemini, then OpenAI-compatible, then the scripted demo', () => {
		expect(getHost({ GEMINI_API_KEY: 'k' }).name).toBe('gemini');
		expect(
			getHost({ HOST_LLM_BASE_URL: 'https://x/v1', HOST_LLM_API_KEY: 'k', HOST_LLM_MODEL: 'm' })
				.name
		).toBe('openai-compatible');
		expect(getHost({}).name).toBe('demo');
	});
});

describe('model adapters (stubbed HTTP)', () => {
	it('GeminiHost parses and sanitizes the generated line', async () => {
		const fetchFn = async () =>
			new Response(
				JSON.stringify({
					candidates: [{ content: { parts: [{ text: '  <i>What</i> a win!  ' }] } }]
				}),
				{ status: 200 }
			);
		const host = new GeminiHost('key', 'gemini-test', fetchFn as typeof fetch);
		expect(host.name).toBe('gemini');
		expect(await host.comment(CTX)).toBe('What a win!');
	});
	it('OpenAICompatibleHost reads choices[0] and posts to /chat/completions', async () => {
		let seenUrl = '';
		const fetchFn = async (url: string | URL | Request) => {
			seenUrl = String(url);
			return new Response(JSON.stringify({ choices: [{ message: { content: 'Nice streak!' } }] }), {
				status: 200
			});
		};
		const host = new OpenAICompatibleHost(
			'https://llm.example/v1/',
			'key',
			'm',
			fetchFn as typeof fetch
		);
		expect(await host.comment(CTX)).toBe('Nice streak!');
		expect(seenUrl).toBe('https://llm.example/v1/chat/completions');
	});
	it('a model HTTP failure throws so the caller can fall back', async () => {
		const host = new GeminiHost(
			'key',
			'm',
			(async () => new Response('nope', { status: 500 })) as typeof fetch
		);
		await expect(host.comment(CTX)).rejects.toThrow(/HTTP 500/);
	});
});

describe('hostComment', () => {
	it('labels scripted output as demo', async () => {
		const res = await hostComment({}, CTX);
		expect(res.adapter).toBe('demo');
		expect(res.line.length).toBeGreaterThan(0);
	});
	it('falls back to the demo host — honestly labelled — when the model call fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('quota', { status: 429 }))
		);
		const res = await hostComment({ GEMINI_API_KEY: 'k' }, CTX);
		expect(res.adapter).toBe('demo');
		expect(res.line.length).toBeGreaterThan(0);
	});
});

/* ------------------------------------------------------------------ */
/* Jev judgment layer                                                   */
/* ------------------------------------------------------------------ */

function typesafeHostResponse(): Response {
	return new Response(
		JSON.stringify({
			model: 'jev-latest',
			answers: {
				tone: {
					type: 'choice',
					choice: 'teasing',
					probabilities: { teasing: 0.7, encouraging: 0.2, dramatic: 0.1 },
					confidence: 0.7
				},
				drama: {
					type: 'score',
					score: 1,
					probabilities: { '0': 0.2, '1': 0.6, '2': 0.2 },
					confidence: 0.6
				}
			},
			usage: { input_tokens: 30, output_tokens: 6 }
		}),
		{ status: 200 }
	);
}

describe('judgeHostMoment', () => {
	it('returns the Jev Choice tone and normalised drama when the model answers', async () => {
		const j = await judgeHostMoment({ TYPESAFE_API_KEY: 'k' }, CTX, (async () =>
			typesafeHostResponse()) as typeof fetch);
		expect(j).toEqual({ tone: 'teasing', drama: 0.5, judge: 'typesafe' });
	});
	it('falls back to the demo judge — labelled demo — when the API fails', async () => {
		const j = await judgeHostMoment({ TYPESAFE_API_KEY: 'k' }, CTX, (async () => {
			throw new Error('network down');
		}) as typeof fetch);
		expect(j.judge).toBe('demo');
		expect(j.tone).toBe('dramatic'); // demo rule: a win is dramatic
		expect(j.drama).toBeGreaterThanOrEqual(0.85);
	});
	it('hostComment threads the judged tone into the scripted line', async () => {
		const res = await hostComment({ TYPESAFE_API_KEY: 'k' }, CTX, (async () =>
			typesafeHostResponse()) as typeof fetch);
		expect(res.judge).toBe('typesafe');
		expect(res.tone).toBe('teasing');
		expect(res.adapter).toBe('demo');
		// The only teasing line in the win bank:
		expect(res.line).toBe('You win! I’ll pretend I helped.');
	});
	it('ScriptedHost honours an explicit tone deterministically', async () => {
		const host = new ScriptedHost();
		expect(await host.comment(CTX, 'dramatic')).toBe(
			'A perfect run! Every card exactly once. Frame it.'
		);
		expect(await host.comment(CTX, 'dramatic')).toBe(await host.comment(CTX, 'dramatic'));
	});
});
