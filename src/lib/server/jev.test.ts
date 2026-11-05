import { describe, expect, it } from 'vitest';
import { DemoJev, type JevQuestion, judgeWithFallback, TypesafeJev, typesafeKey } from './jev';

const QUESTIONS: Record<string, JevQuestion> = {
	rel: { type: 'noul', instructions: 'Is `title` actually about `theme`?' },
	fit: {
		type: 'choice',
		instructions: 'How well does `title` fit `theme`?',
		criteria: {
			'perfect-fit': 'clearly on-theme',
			usable: 'related enough',
			'off-theme': 'unrelated'
		}
	},
	drama: {
		type: 'score',
		instructions: 'How dramatic is this moment?',
		criteria: ['routine', 'tense', 'climactic']
	}
};

function typesafeResponse(): Response {
	return new Response(
		JSON.stringify({
			model: 'jev-latest',
			answers: {
				rel: { type: 'noul', noul: 0.93 },
				fit: {
					type: 'choice',
					choice: 'perfect-fit',
					probabilities: { 'perfect-fit': 0.9, usable: 0.08, 'off-theme': 0.02 },
					confidence: 0.9
				},
				drama: {
					type: 'score',
					score: 1.5,
					probabilities: { '0': 0.1, '1': 0.3, '2': 0.6 },
					confidence: 0.6
				}
			},
			usage: { input_tokens: 42, output_tokens: 9 }
		}),
		{ status: 200 }
	);
}

describe('TypesafeJev (REST client, mocked HTTP)', () => {
	it('posts state + typed questions to /v1/systemone with Bearer auth', async () => {
		let seenUrl = '';
		let seenInit: RequestInit | undefined;
		const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
			seenUrl = String(input);
			seenInit = init;
			return typesafeResponse();
		};
		const client = new TypesafeJev({ apiKey: 'test-key', fetchFn: fetchFn as typeof fetch });
		const answers = await client.evaluate({ theme: 'ocean', title: 'Ocean reef' }, QUESTIONS);
		expect(seenUrl).toBe('https://api.typesafe.ai/v1/systemone');
		const headers = seenInit?.headers as Record<string, string>;
		expect(headers.authorization).toBe('Bearer test-key');
		const body = JSON.parse(String(seenInit?.body)) as {
			model: string;
			state: unknown;
			questions: Record<string, { type: string }>;
		};
		expect(body.model).toBe('jev-latest');
		expect(body.state).toEqual({ theme: 'ocean', title: 'Ocean reef' });
		expect(body.questions.rel?.type).toBe('noul');
		expect(body.questions.fit?.type).toBe('choice');
		// Typed answers come back parsed, keyed by question id.
		expect(answers.rel).toEqual({ type: 'noul', noul: 0.93 });
		expect(answers.fit).toMatchObject({ type: 'choice', choice: 'perfect-fit', confidence: 0.9 });
		expect(answers.drama).toMatchObject({ type: 'score', score: 1.5 });
	});
	it('throws on HTTP failure and on malformed responses', async () => {
		const httpFail = new TypesafeJev({
			apiKey: 'k',
			fetchFn: (async () => new Response('no', { status: 500 })) as typeof fetch
		});
		await expect(httpFail.evaluate('s', QUESTIONS)).rejects.toThrow(/http 500/);
		const malformed = new TypesafeJev({
			apiKey: 'k',
			fetchFn: (async () =>
				new Response(JSON.stringify({ model: 'jev-latest' }), { status: 200 })) as typeof fetch
		});
		await expect(malformed.evaluate('s', QUESTIONS)).rejects.toThrow(/missing answers/);
		const missingOne = new TypesafeJev({
			apiKey: 'k',
			fetchFn: (async () =>
				new Response(JSON.stringify({ answers: { rel: { type: 'noul', noul: 0.5 } } }), {
					status: 200
				})) as typeof fetch
		});
		await expect(missingOne.evaluate('s', QUESTIONS)).rejects.toThrow(/missing/);
	});
});

describe('judgeWithFallback', () => {
	it('uses the real model when a key is set and the call succeeds', async () => {
		const res = await judgeWithFallback(
			{ TYPESAFE_API_KEY: 'k' },
			{ theme: 'ocean', title: 'Ocean reef' },
			QUESTIONS,
			(async () => typesafeResponse()) as typeof fetch
		);
		expect(res.judge).toBe('typesafe');
		expect(res.answers.rel).toEqual({ type: 'noul', noul: 0.93 });
	});
	it('falls back to the demo judge — labelled demo — when the API fails', async () => {
		const res = await judgeWithFallback(
			{ TYPESAFE_API_KEY: 'k' },
			{ theme: 'ocean animals', title: 'Ocean animals reef' },
			QUESTIONS,
			(async () => {
				throw new Error('network down');
			}) as typeof fetch
		);
		expect(res.judge).toBe('demo');
		expect(res.answers.rel?.type).toBe('noul');
	});
	it('uses the demo judge when no key is configured', async () => {
		const res = await judgeWithFallback({}, 'anything', QUESTIONS);
		expect(res.judge).toBe('demo');
	});
	it('typesafeKey ignores empty keys', () => {
		expect(typesafeKey({})).toBeUndefined();
		expect(typesafeKey({ TYPESAFE_API_KEY: '  ' })).toBeUndefined();
		expect(typesafeKey({ TYPESAFE_API_KEY: 'k' })).toBe('k');
	});
});

describe('DemoJev (deterministic heuristics)', () => {
	const demo = new DemoJev();
	it('is deterministic: same state + questions, same answers', async () => {
		const state = { theme: 'ocean animals', title: 'Ocean animals reef' };
		expect(await demo.evaluate(state, QUESTIONS)).toEqual(await demo.evaluate(state, QUESTIONS));
	});
	it('scores on-theme titles as relevant and unrelated titles as not', async () => {
		const onTheme = await demo.evaluate(
			{ theme: 'ocean animals', title: 'Ocean animals of the reef' },
			QUESTIONS
		);
		expect(onTheme.rel).toMatchObject({ type: 'noul' });
		if (onTheme.rel?.type === 'noul') expect(onTheme.rel.noul).toBeGreaterThanOrEqual(0.9);
		expect(onTheme.fit).toMatchObject({ type: 'choice', choice: 'perfect-fit' });
		const offTheme = await demo.evaluate(
			{ theme: 'ocean animals', title: 'Mountain hiking trail' },
			QUESTIONS
		);
		if (offTheme.rel?.type === 'noul') expect(offTheme.rel.noul).toBeLessThan(0.3);
		expect(offTheme.fit).toMatchObject({ type: 'choice', choice: 'off-theme' });
	});
	it('flags blocklisted content as inappropriate', async () => {
		const res = await demo.evaluate(
			{ theme: 'party', title: 'Horror gore party' },
			{
				appropriate: {
					type: 'noul',
					instructions: 'Is `title` appropriate for a family-friendly game for all ages?'
				}
			}
		);
		if (res.appropriate?.type === 'noul') expect(res.appropriate.noul).toBeLessThan(0.2);
		else throw new Error('expected noul answer');
	});
	it('picks host tones by event and scores a win as dramatic', async () => {
		const res = await demo.evaluate(
			{ event: 'win', mode: 'classic', score: 12, streak: 12, remaining: 0 },
			{
				tone: {
					type: 'choice',
					instructions: 'Which tone should the host use?',
					criteria: { teasing: 'ribbing', encouraging: 'warm', dramatic: 'announcer' }
				},
				drama: {
					type: 'score',
					instructions: 'How dramatic is this moment?',
					criteria: ['routine', 'tense', 'climactic']
				}
			}
		);
		expect(res.tone).toMatchObject({ type: 'choice', choice: 'dramatic' });
		if (res.drama?.type === 'score') {
			expect(res.drama.score).toBeGreaterThanOrEqual(1.7);
			expect(res.drama.score).toBeLessThanOrEqual(2);
		} else throw new Error('expected score answer');
		const bust = await demo.evaluate(
			{ event: 'bust', mode: 'classic', score: 3, streak: 3, remaining: 9 },
			{
				tone: {
					type: 'choice',
					instructions: 'Which tone should the host use?',
					criteria: { teasing: 'ribbing', encouraging: 'warm', dramatic: 'announcer' }
				}
			}
		);
		expect(bust.tone).toMatchObject({ type: 'choice', choice: 'teasing' });
	});
});
