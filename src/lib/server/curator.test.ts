import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	type CandidateJudge,
	type CandidateJudgment,
	type CurateEvent,
	createCandidateJudge,
	curateDeck,
	type ImageCandidate,
	type ImageSource,
	JEV_ACCEPT_THRESHOLD,
	jevGate,
	licenseAllowed,
	OpenverseSource,
	offlineValidator,
	sanitizeTheme
} from './curator';

function candidate(id: string, license = 'by'): ImageCandidate {
	return {
		id: `ov-${id}`,
		title: `Photo ${id}`,
		imageUrl: `https://images.example/${id}.jpg`,
		license,
		attribution: 'Photo by Test via Openverse'
	};
}

class FakeSource implements ImageSource {
	readonly name = 'openverse';
	queries: string[] = [];
	constructor(private pages: ImageCandidate[][]) {}
	async search(query: string): Promise<ImageCandidate[]> {
		this.queries.push(query);
		return this.pages[this.queries.length - 1] ?? [];
	}
}

class ThrowingSource implements ImageSource {
	readonly name = 'openverse';
	async search(): Promise<ImageCandidate[]> {
		throw new Error('network down');
	}
}

async function collect(gen: AsyncGenerator<CurateEvent>): Promise<CurateEvent[]> {
	const out: CurateEvent[] = [];
	for await (const e of gen) out.push(e);
	return out;
}

describe('OpenverseSource — Workers fetch binding', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('the default fetch path keeps the global receiver (workerd "Illegal invocation" guard)', async () => {
		// workerd throws when fetch is called with the wrong `this`; this stub
		// reproduces that contract so the regression is caught in Node too.
		vi.stubGlobal('fetch', function (this: unknown) {
			if (this !== globalThis) throw new Error('Illegal invocation');
			return Promise.resolve(
				new Response(
					JSON.stringify({
						results: [
							{
								id: 'r1',
								title: 'Ray',
								url: 'https://img.example/r.jpg',
								license: 'by',
								creator: 'Sam'
							}
						]
					}),
					{ status: 200 }
				)
			);
		});
		const source = new OpenverseSource();
		const results = await source.search('rays', 5);
		expect(results).toHaveLength(1);
		expect(results[0]?.attribution).toContain('Sam');
	});
});

describe('licenseAllowed', () => {
	it('accepts attribution-friendly licenses, rejects the rest', () => {
		expect(licenseAllowed('by')).toBe(true);
		expect(licenseAllowed('CC0')).toBe(true);
		expect(licenseAllowed('by-nd')).toBe(false);
		expect(licenseAllowed('all-rights-reserved')).toBe(false);
	});
});

describe('sanitizeTheme', () => {
	it('trims, collapses whitespace and strips markup characters', () => {
		expect(sanitizeTheme('  deep   sea ')).toBe('deep sea');
		expect(sanitizeTheme('<b>cats</b>')).toBe('bcats/b');
	});
	it('rejects empty and non-string themes and caps length', () => {
		expect(sanitizeTheme('   ')).toBeNull();
		expect(sanitizeTheme(42)).toBeNull();
		expect(sanitizeTheme('x'.repeat(500))).toHaveLength(60);
	});
});

describe('curateDeck — happy path', () => {
	it('assembles a 12-card deck from validated live results', async () => {
		const source = new FakeSource([Array.from({ length: 14 }, (_, i) => candidate(`a${i}`))]);
		const events = await collect(curateDeck('cats', { source, validator: offlineValidator }));
		const done = events.at(-1);
		expect(done?.type).toBe('done');
		if (done?.type === 'done') {
			expect(done.deck.source).toBe('openverse');
			expect(done.deck.cards).toHaveLength(12);
			expect(done.deck.cards[0]?.license).toBe('by');
		}
		expect(events.map((e) => e.type)).toEqual(['plan', 'search', 'validate', 'done']);
	});
	it('dedupes and rejects bad licenses during validation', async () => {
		const page = [
			candidate('a1'),
			candidate('a1'), // duplicate
			candidate('a2', 'by-nd'), // license not allowed
			...Array.from({ length: 11 }, (_, i) => candidate(`b${i}`))
		];
		const source = new FakeSource([page]);
		const events = await collect(curateDeck('dogs', { source, validator: offlineValidator }));
		const validate = events.find((e) => e.type === 'validate');
		expect(validate).toMatchObject({ accepted: 12, rejected: 2 });
	});
});

describe('curateDeck — retries and fallback', () => {
	it('broadens the query when validation leaves the deck short', async () => {
		const source = new FakeSource([
			[candidate('only-one')],
			Array.from({ length: 12 }, (_, i) => candidate(`c${i}`))
		]);
		const events = await collect(curateDeck('axolotl', { source, validator: offlineValidator }));
		expect(source.queries).toEqual(['axolotl', 'axolotl animal']);
		const done = events.at(-1);
		expect(done?.type).toBe('done');
		if (done?.type === 'done') expect(done.deck.source).toBe('openverse');
	});
	it('falls back to an honestly-labelled demo deck when the source fails', async () => {
		const events = await collect(
			curateDeck('deep sea animals', { source: new ThrowingSource(), validator: offlineValidator })
		);
		expect(events.some((e) => e.type === 'fallback')).toBe(true);
		const done = events.at(-1);
		expect(done?.type).toBe('done');
		if (done?.type === 'done') {
			expect(done.deck.source).toBe('demo');
			expect(done.deck.notice).toBeTruthy();
			expect(done.deck.cards).toHaveLength(12);
		}
	});
	it('falls back when too few candidates survive all searches', async () => {
		const source = new FakeSource([[candidate('x1')], [candidate('x2')], [candidate('x3')]]);
		const events = await collect(curateDeck('obscure', { source, validator: offlineValidator }));
		expect(source.queries).toHaveLength(3);
		const done = events.at(-1);
		if (done?.type === 'done') expect(done.deck.source).toBe('demo');
		else throw new Error('expected done event');
	});
});

/* ------------------------------------------------------------------ */
/* Jev judgment gate                                                    */
/* ------------------------------------------------------------------ */

function fakeJudge(
	judgments: Map<string, CandidateJudgment>,
	kind: 'typesafe' | 'demo' = 'typesafe'
): CandidateJudge & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		kind: () => kind,
		async judge(_theme, c) {
			calls.push(c.id);
			const j = judgments.get(c.id);
			if (!j) throw new Error(`no judgment stubbed for ${c.id}`);
			return j;
		}
	};
}

const GOOD: CandidateJudgment = {
	relevance: 0.92,
	appropriate: 0.98,
	category: 'perfect-fit',
	confidence: 0.9
};

describe('jevGate — calibrated acceptance threshold', () => {
	it('accepts at exactly the threshold and reports telemetry', async () => {
		const c = candidate('g1');
		const judge = fakeJudge(
			new Map([
				[c.id, { ...GOOD, relevance: JEV_ACCEPT_THRESHOLD, appropriate: JEV_ACCEPT_THRESHOLD }]
			])
		);
		const gate = jevGate(offlineValidator, judge, 'cats');
		expect(await gate.validator.validate(c, new Set())).toBe(true);
		expect(gate.summary()).toEqual({
			kind: 'typesafe',
			judged: 1,
			accepted: 1,
			meanConfidence: 0.9
		});
	});
	it('rejects below-threshold relevance, low appropriateness, and off-theme picks', async () => {
		const cases: Array<[string, CandidateJudgment]> = [
			['low-rel', { ...GOOD, relevance: 0.69 }],
			['low-app', { ...GOOD, appropriate: 0.5 }],
			['off-theme', { ...GOOD, category: 'off-theme' }]
		];
		for (const [id, judgment] of cases) {
			const c = candidate(id);
			const gate = jevGate(offlineValidator, fakeJudge(new Map([[c.id, judgment]])), 'cats');
			expect(await gate.validator.validate(c, new Set())).toBe(false);
			expect(gate.summary().accepted).toBe(0);
		}
	});
	it('never spends a Jev call on candidates the cheap checks already reject', async () => {
		const c = candidate('bad-license', 'by-nd');
		const judge = fakeJudge(new Map());
		const gate = jevGate(offlineValidator, judge, 'cats');
		expect(await gate.validator.validate(c, new Set())).toBe(false);
		expect(judge.calls).toEqual([]);
	});
	it('createCandidateJudge without a key uses the demo judge, labelled demo', async () => {
		const judge = createCandidateJudge({});
		expect(judge.kind()).toBe('demo');
		const j = await judge.judge('ocean animals', {
			...candidate('d1'),
			title: 'Ocean animals of the reef'
		});
		expect(j.relevance).toBeGreaterThanOrEqual(0.9);
		expect(j.appropriate).toBeGreaterThanOrEqual(0.9);
		expect(j.category).toBe('perfect-fit');
	});
	it('a gated curateDeck run attaches the judge summary to the deck', async () => {
		const page = Array.from({ length: 14 }, (_, i) => ({
			...candidate(`j${i}`),
			title: `Ocean animals ${i}`
		}));
		const source = new FakeSource([page]);
		const judge = createCandidateJudge({});
		const gate = jevGate(offlineValidator, judge, 'ocean animals');
		const events = await collect(
			curateDeck('ocean animals', {
				source,
				validator: gate.validator,
				judgeKind: judge.kind(),
				judgeSummary: gate.summary
			})
		);
		const plan = events[0];
		expect(plan).toMatchObject({ type: 'plan', judge: 'demo' });
		const done = events.at(-1);
		if (done?.type !== 'done') throw new Error('expected done event');
		expect(done.deck.source).toBe('openverse');
		expect(done.deck.judge?.kind).toBe('demo');
		expect(done.deck.judge?.accepted).toBe(12);
		expect(done.deck.judge?.judged).toBeGreaterThanOrEqual(12);
	});
});
