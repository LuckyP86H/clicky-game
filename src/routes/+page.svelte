<script lang="ts">
import { onMount } from 'svelte';
import { flip } from 'svelte/animate';
import {
	loadProfile,
	type Profile,
	recordRun,
	saveProfile,
	unlockedAchievements
} from '#lib/client/profile.js';
import CuratorPanel from '#lib/components/CuratorPanel.svelte';
import GameCard from '#lib/components/GameCard.svelte';
import HostBubble from '#lib/components/HostBubble.svelte';
import LeaderboardPanel from '#lib/components/LeaderboardPanel.svelte';
import StatsPanel from '#lib/components/StatsPanel.svelte';
import { DAILY_POOL, DEFAULT_DECK } from '#lib/decks.js';
import {
	applyClick,
	applyTimeout,
	createRun,
	dailyDeck,
	localDateString,
	timeLeft
} from '#lib/engine.js';
import type { Deck, GameEvent, Mode, RunState } from '#lib/types.js';

let mode = $state<Mode>('classic');
let deck = $state<Deck>(DEFAULT_DECK);
let run = $state<RunState | null>(null);
let profile = $state<Profile | null>(null);
let hostLine = $state<string | null>(null);
let hostAdapter = $state<string | null>(null);
let hostJudgment = $state<{ judge: string; tone: string; drama: number } | null>(null);
let pendingScore = $state<{ score: number; mode: Mode } | null>(null);
let nowMs = $state(Date.now());
let recordedKey = $state<string | null>(null);

const today = localDateString(new Date());
const cardById = $derived(new Map(deck.cards.map((c) => [c.id, c])));
const orderedCards = $derived(run ? run.order.flatMap((id) => cardById.get(id) ?? []) : []);
const achievements = $derived(profile ? unlockedAchievements(profile.history) : []);
const best = $derived(profile?.bestByMode[mode] ?? 0);
const secondsLeft = $derived(
	run && run.mode === 'timed' ? Math.ceil(timeLeft(run, nowMs) / 1000) : null
);

const STATUS_TEXT: Record<string, string> = {
	won: 'You win! Every card exactly once. 🎉',
	bust: 'Bust! That card was already clicked.',
	timeup: "Time's up!"
};

function randomSeed(): number {
	return Math.floor(Math.random() * 2 ** 31);
}

async function fetchHostLine(event: GameEvent, forRun: RunState) {
	try {
		const res = await fetch('/api/comment', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				event: event.type,
				mode: forRun.mode,
				score: event.score,
				streak: event.streak,
				remaining: event.remaining,
				...(event.cardTitle ? { cardTitle: event.cardTitle } : {}),
				deckName: deck.name
			})
		});
		if (!res.ok) return;
		const data = (await res.json()) as {
			line: string;
			adapter: string;
			judge?: string;
			tone?: string;
			drama?: number;
		};
		hostLine = data.line;
		hostAdapter = data.adapter;
		hostJudgment =
			data.judge && data.tone
				? { judge: data.judge, tone: data.tone, drama: data.drama ?? 0 }
				: null;
	} catch {
		// The host is garnish — if it is unreachable the game just goes quiet.
	}
}

function settle(next: RunState) {
	run = next;
	const event = next.lastEvent;
	if (event) {
		const withTitle: GameEvent = { ...event };
		const title = event.cardId ? cardById.get(event.cardId)?.title : undefined;
		if (title) withTitle.cardTitle = title;
		if (event.type !== 'hit') void fetchHostLine(withTitle, next);
	}
	if (next.status !== 'playing' && profile) {
		const key = `${next.seed}:${next.startedAt}`;
		if (recordedKey !== key) {
			recordedKey = key;
			const updated = recordRun(profile, {
				ts: Date.now(),
				date: today,
				mode: next.mode,
				deckId: next.deckId,
				score: next.score,
				result: next.status
			});
			profile = updated;
			saveProfile(window.localStorage, updated);
			pendingScore = { score: next.score, mode: next.mode };
		}
	}
}

function startRun(newMode: Mode, newDeck: Deck) {
	mode = newMode;
	recordedKey = null;
	pendingScore = null;
	let next: RunState;
	if (newMode === 'daily') {
		// The daily board comes from the date seed, not from the current deck.
		const dd = dailyDeck(DAILY_POOL, today);
		deck = {
			id: `daily-${today}`,
			name: `Daily Challenge · ${today}`,
			source: 'builtin',
			cards: dd.cards
		};
		next = createRun({ mode: 'daily', deck, seed: dd.seed, now: Date.now() });
	} else {
		// Never carry the daily board into the free-play modes.
		deck = newDeck.id.startsWith('daily-') ? DEFAULT_DECK : newDeck;
		next = createRun({ mode: newMode, deck, seed: randomSeed(), now: Date.now() });
	}
	run = next;
	if (next.lastEvent) void fetchHostLine(next.lastEvent, next);
}

function pick(id: string) {
	if (run?.status !== 'playing') return;
	settle(applyClick(run, id, Date.now()));
}

onMount(() => {
	profile = loadProfile(window.localStorage);
	startRun('classic', DEFAULT_DECK);
	const timer = setInterval(() => {
		nowMs = Date.now();
		if (run && run.mode === 'timed' && run.status === 'playing') {
			const next = applyTimeout(run, nowMs);
			if (next !== run) settle(next);
		}
	}, 200);
	return () => clearInterval(timer);
});
</script>

<svelte:head>
	<title>Clickster — the click-once memory game</title>
</svelte:head>

<header class="site-header">
	<h1>🖱️ Clickster</h1>
	<p class="tagline">Click every card exactly once. One repeat ends the run — and the board shuffles after every click.</p>
</header>

<main class="layout">
	<section class="game" aria-label="Game board">
		<div class="mode-tabs" role="tablist" aria-label="Game mode">
			{#each ['classic', 'timed', 'daily'] as const as m (m)}
				<button
					type="button"
					role="tab"
					aria-selected={mode === m}
					class:active={mode === m}
					data-testid={`mode-${m}`}
					onclick={() => startRun(m, deck)}
				>
					{m === 'classic' ? 'Classic' : m === 'timed' ? 'Timed (60s)' : `Daily · ${today}`}
				</button>
			{/each}
			{#if deck.id !== DEFAULT_DECK.id && mode !== 'daily'}
				<button type="button" class="ghost" onclick={() => startRun(mode, DEFAULT_DECK)}>
					Back to Cosmic Critters
				</button>
			{/if}
		</div>

		<div class="scorebar" data-testid="scorebar">
			<span>Score <strong data-testid="score">{run?.score ?? 0}</strong> / {deck.cards.length}</span>
			<span>Best <strong>{best}</strong></span>
			{#if secondsLeft !== null && run?.status === 'playing'}
				<span class="timer" data-testid="timer">⏱ {secondsLeft}s</span>
			{/if}
			<span class="deck-name">{deck.name}{deck.source === 'demo' ? ' · demo deck' : ''}</span>
		</div>

		<HostBubble line={hostLine} adapter={hostAdapter} judgment={hostJudgment} />

		{#if run && run.status !== 'playing'}
			<div class="run-end" role="status" data-testid="run-end">
				<p>{STATUS_TEXT[run.status]}</p>
				<button type="button" data-testid="play-again" onclick={() => startRun(mode, deck)}>
					Play again
				</button>
			</div>
		{/if}

		{#if run}
			<div class="grid" data-testid="board">
				{#each orderedCards as card (card.id)}
					<div class="cell" animate:flip={{ duration: 280 }}>
						<GameCard {card} disabled={run.status !== 'playing'} onpick={pick} />
					</div>
				{/each}
			</div>
		{:else}
			<p class="loading">Shuffling the deck…</p>
		{/if}

		{#if profile && profile.history.length > 0}
			<section class="history" aria-label="Your progress">
				<h2>Your progress</h2>
				<p class="hint">
					Best streak: <strong>{profile.bestStreak}</strong> · Runs played:
					<strong>{profile.history.length}</strong>
				</p>
				{#if achievements.length > 0}
					<ul class="badges" data-testid="achievements">
						{#each achievements as a (a.id)}
							<li title={a.detail}>🏅 {a.name}</li>
						{/each}
					</ul>
				{/if}
				<ul class="runs">
					{#each profile.history.slice(0, 5) as h (h.ts)}
						<li>
							{h.date} · {h.mode} · {h.deckId} — <strong>{h.score}</strong> ({h.result})
						</li>
					{/each}
				</ul>
				<StatsPanel history={profile.history} {today} />
			</section>
		{/if}
	</section>

	<aside class="sidebar">
		<CuratorPanel onplay={(d) => startRun('classic', d)} />
		<LeaderboardPanel pending={pendingScore} />
	</aside>
</main>

<footer class="site-footer">
	<p>
		Clickster — rebuilt with SvelteKit, Cloudflare Workers, an AI deck-curator agent, an AI host,
		and a Redis leaderboard. Card art for bundled decks is generated in-code; curated decks credit
		their photographers.
	</p>
</footer>

<style>
	.site-header {
		text-align: center;
		padding: 1.6rem 1rem 0.4rem;
	}
	.site-header h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
	}
	.tagline {
		color: var(--ink-dim);
		max-width: 34rem;
		margin: 0.4rem auto 0;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 1.2rem;
		max-width: 1100px;
		margin: 0 auto;
		padding: 1rem;
		align-items: start;
	}
	@media (max-width: 860px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.mode-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.8rem;
	}
	.mode-tabs button {
		border: 1px solid var(--card-border);
		background: var(--panel);
		color: var(--ink);
		border-radius: 999px;
		padding: 0.45rem 1rem;
		cursor: pointer;
		font-weight: 600;
	}
	.mode-tabs button.active {
		background: var(--accent);
		color: #14100c;
		border-color: var(--accent);
	}
	.mode-tabs .ghost {
		background: transparent;
		color: var(--ink-dim);
	}
	.scorebar {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: baseline;
		padding: 0.6rem 0.2rem;
		font-size: 1.02rem;
	}
	.scorebar .timer {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	.scorebar .deck-name {
		color: var(--ink-dim);
		font-size: 0.85rem;
		margin-left: auto;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.8rem;
		margin-top: 0.9rem;
	}
	@media (max-width: 560px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.55rem;
		}
	}
	.cell :global(.card) {
		width: 100%;
		height: 100%;
	}
	.run-end {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.8rem;
		padding: 0.7rem 1rem;
		border-radius: 0.9rem;
		background: var(--panel);
		border: 1px solid var(--accent);
	}
	.run-end p {
		margin: 0;
		flex: 1;
		font-weight: 700;
	}
	.run-end button {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: none;
		background: var(--accent);
		color: #14100c;
		font-weight: 700;
		cursor: pointer;
	}
	.history {
		margin-top: 1.4rem;
	}
	.history h2 {
		font-size: 1.05rem;
		margin: 0 0 0.3rem;
	}
	.hint {
		color: var(--ink-dim);
		font-size: 0.88rem;
		margin: 0.2rem 0;
	}
	.badges {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0;
		margin: 0.5rem 0;
	}
	.badges li {
		border: 1px solid var(--card-border);
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		font-size: 0.8rem;
		background: var(--panel);
	}
	.runs {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0;
		color: var(--ink-dim);
		font-size: 0.85rem;
		display: grid;
		gap: 0.2rem;
	}
	.sidebar {
		display: grid;
		gap: 1.2rem;
	}
	.loading {
		color: var(--ink-dim);
	}
	.site-footer {
		max-width: 1100px;
		margin: 0 auto;
		padding: 0.4rem 1rem 2rem;
		color: var(--ink-dim);
		font-size: 0.82rem;
	}
</style>
