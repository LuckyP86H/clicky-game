import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoreEntry } from '../types';
import {
	InMemoryLeaderboard,
	leaderboardKey,
	parseScoreSubmission,
	UpstashLeaderboard
} from './leaderboard';

const entry = (
	name: string,
	score: number,
	ts: number,
	mode: 'classic' | 'daily' = 'classic',
	date?: string
): ScoreEntry => {
	const e: ScoreEntry = { name, score, mode, ts };
	if (date) e.date = date;
	return e;
};

describe('leaderboardKey', () => {
	it('namespaces per mode, and per date for daily', () => {
		expect(leaderboardKey('classic')).toBe('clicky:lb:classic');
		expect(leaderboardKey('timed')).toBe('clicky:lb:timed');
		expect(leaderboardKey('daily', '2026-10-29')).toBe('clicky:lb:daily:2026-10-29');
	});
});

describe('InMemoryLeaderboard', () => {
	it('returns top scores highest-first, capped at n', async () => {
		const lb = new InMemoryLeaderboard();
		await lb.add(entry('Ada', 7, 100));
		await lb.add(entry('Bo', 12, 101));
		await lb.add(entry('Cy', 9, 102));
		const top = await lb.top('classic', 2);
		expect(top.map((e) => [e.name, e.score])).toEqual([
			['Bo', 12],
			['Cy', 9]
		]);
	});
	it('keeps modes and daily dates on separate boards', async () => {
		const lb = new InMemoryLeaderboard();
		await lb.add(entry('Ada', 5, 100, 'daily', '2026-10-29'));
		await lb.add(entry('Bo', 6, 101, 'daily', '2026-10-30'));
		await lb.add(entry('Cy', 7, 102));
		expect((await lb.top('daily', 10, '2026-10-29')).map((e) => e.name)).toEqual(['Ada']);
		expect((await lb.top('daily', 10, '2026-10-30')).map((e) => e.name)).toEqual(['Bo']);
		expect((await lb.top('classic', 10)).map((e) => e.name)).toEqual(['Cy']);
	});
	it('mirrors ZADD: re-adding the identical member replaces, not duplicates', async () => {
		const lb = new InMemoryLeaderboard();
		await lb.add(entry('Ada', 7, 100));
		await lb.add(entry('Ada', 7, 100));
		expect(await lb.top('classic', 10)).toHaveLength(1);
		// …but a new run (new timestamp) is a new member.
		await lb.add(entry('Ada', 8, 200));
		expect(await lb.top('classic', 10)).toHaveLength(2);
	});
	it('breaks score ties exactly like Redis ZREVRANGE (reverse-lexicographic member)', async () => {
		const lb = new InMemoryLeaderboard();
		await lb.add(entry('Ada', 9, 100));
		await lb.add(entry('Bob', 9, 101));
		// Members are {"n":"Ada",…} and {"n":"Bob",…}: reverse-lexicographic
		// order puts Bob's member first, regardless of submission order.
		expect((await lb.top('classic', 10)).map((e) => e.name)).toEqual(['Bob', 'Ada']);
	});
});

describe('UpstashLeaderboard', () => {
	function fakeFetch(result: unknown, capture: (url: string, init: RequestInit) => void) {
		return async (url: string | URL | Request, init?: RequestInit) => {
			capture(String(url), init ?? {});
			return new Response(JSON.stringify({ result }), { status: 200 });
		};
	}

	it('issues ZADD with the namespaced key, score and JSON member', async () => {
		let body: unknown;
		const lb = new UpstashLeaderboard(
			{ url: 'https://redis.example/', token: 'tok' },
			fakeFetch(1, (_url, init) => {
				body = JSON.parse(String(init.body));
			}) as typeof fetch
		);
		await lb.add(entry('Ada', 9, 555));
		expect(body).toEqual(['ZADD', 'clicky:lb:classic', 9, '{"n":"Ada","s":9,"t":555}']);
	});

	it('issues ZREVRANGE WITHSCORES and parses the flat reply', async () => {
		let body: unknown;
		const lb = new UpstashLeaderboard(
			{ url: 'https://redis.example', token: 'tok' },
			fakeFetch(
				['{"n":"Bo","s":12,"t":101}', '12', '{"n":"Ada","s":9,"t":100}', '9'],
				(_url, init) => {
					body = JSON.parse(String(init.body));
				}
			) as typeof fetch
		);
		const top = await lb.top('classic', 10);
		expect(body).toEqual(['ZREVRANGE', 'clicky:lb:classic', 0, 9, 'WITHSCORES']);
		expect(top.map((e) => [e.name, e.score])).toEqual([
			['Bo', 12],
			['Ada', 9]
		]);
	});
});

describe('UpstashLeaderboard — Workers fetch binding', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('the default fetch path keeps the global receiver', async () => {
		vi.stubGlobal('fetch', function (this: unknown) {
			if (this !== globalThis) throw new Error('Illegal invocation');
			return Promise.resolve(new Response(JSON.stringify({ result: 1 }), { status: 200 }));
		});
		const lb = new UpstashLeaderboard({ url: 'https://redis.example', token: 'tok' });
		await expect(lb.add(entry('Ada', 9, 555))).resolves.toBeUndefined();
	});
});

describe('parseScoreSubmission', () => {
	it('accepts a valid submission and stamps the time server-side', () => {
		const e = parseScoreSubmission({ name: 'Ada', score: 9, mode: 'classic' });
		expect(e?.name).toBe('Ada');
		expect(e?.score).toBe(9);
		expect(typeof e?.ts).toBe('number');
	});
	it('strips markup from names and rejects empty results', () => {
		expect(
			parseScoreSubmission({ name: '<script>x</script>', score: 1, mode: 'classic' })?.name
		).toBe('scriptx/script');
		expect(parseScoreSubmission({ name: '<>', score: 1, mode: 'classic' })).toBeNull();
	});
	it('rejects bad scores, bad modes and daily-without-date', () => {
		expect(parseScoreSubmission({ name: 'A', score: -1, mode: 'classic' })).toBeNull();
		expect(parseScoreSubmission({ name: 'A', score: 1.5, mode: 'classic' })).toBeNull();
		expect(parseScoreSubmission({ name: 'A', score: 1, mode: 'ranked' })).toBeNull();
		expect(parseScoreSubmission({ name: 'A', score: 1, mode: 'daily' })).toBeNull();
		expect(
			parseScoreSubmission({ name: 'A', score: 1, mode: 'daily', date: '29-10-2026' })
		).toBeNull();
		expect(parseScoreSubmission(null)).toBeNull();
	});
});
