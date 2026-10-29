<script lang="ts">
import { localDateString } from '#lib/engine.js';
import type { Mode, ScoreEntry } from '#lib/types.js';

interface Props {
	/** The most recently finished run, offered for submission. */
	pending: { score: number; mode: Mode } | null;
}

let { pending }: Props = $props();

let tab = $state<Mode>('classic');
let entries = $state<ScoreEntry[]>([]);
let storeKind = $state<string>('');
let name = $state('');
let message = $state<string | null>(null);
let loading = $state(false);

const today = localDateString(new Date());

async function load(mode: Mode) {
	loading = true;
	try {
		const params = new URLSearchParams({ mode, n: '10' });
		if (mode === 'daily') params.set('date', today);
		const res = await fetch(`/api/leaderboard?${params}`);
		if (!res.ok) throw new Error(`leaderboard failed (${res.status})`);
		const data = (await res.json()) as { entries: ScoreEntry[]; store: string };
		entries = data.entries;
		storeKind = data.store;
	} catch {
		entries = [];
		message = 'Leaderboard unavailable right now.';
	} finally {
		loading = false;
	}
}

$effect(() => {
	void load(tab);
});

async function submit() {
	if (!pending || name.trim().length === 0) return;
	message = null;
	try {
		const res = await fetch('/api/leaderboard', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: name.trim(),
				score: pending.score,
				mode: pending.mode,
				...(pending.mode === 'daily' ? { date: today } : {})
			})
		});
		if (!res.ok) throw new Error(`submit failed (${res.status})`);
		const data = (await res.json()) as { rank: number | null };
		message = data.rank ? `Submitted — you are #${data.rank} on this board.` : 'Submitted.';
		tab = pending.mode;
		await load(pending.mode);
	} catch {
		message = 'Could not submit that score.';
	}
}
</script>

<section class="panel" aria-labelledby="lb-heading">
	<h2 id="lb-heading">
		Leaderboard
		{#if storeKind}<span class="store">{storeKind === 'redis' ? 'Redis' : 'in-memory (demo)'}</span>{/if}
	</h2>
	<div class="tabs" role="tablist" aria-label="Leaderboard mode">
		{#each ['classic', 'timed', 'daily'] as const as m (m)}
			<button
				type="button"
				role="tab"
				aria-selected={tab === m}
				class:active={tab === m}
				onclick={() => (tab = m)}
			>
				{m}
			</button>
		{/each}
	</div>
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if entries.length === 0}
		<p class="hint" data-testid="lb-empty">No scores yet — be the first.</p>
	{:else}
		<ol class="board" data-testid="lb-entries">
			{#each entries as entry, i (entry.ts + entry.name)}
				<li>
					<span class="rank">#{i + 1}</span>
					<span class="who">{entry.name}</span>
					<span class="score">{entry.score}</span>
				</li>
			{/each}
		</ol>
	{/if}
	{#if pending}
		<form
			class="submit"
			onsubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			<p class="hint">
				Your last {pending.mode} run scored <strong>{pending.score}</strong>. Put it on the board:
			</p>
			<div class="row">
				<label class="visually-hidden" for="lb-name">Your name</label>
				<input
					id="lb-name"
					data-testid="lb-name"
					type="text"
					maxlength="24"
					placeholder="Your name"
					bind:value={name}
				/>
				<button type="submit" data-testid="lb-submit" disabled={name.trim().length === 0}>
					Submit
				</button>
			</div>
		</form>
	{/if}
	{#if message}<p class="hint" data-testid="lb-message">{message}</p>{/if}
</section>

<style>
	.panel {
		background: var(--panel);
		border: 1px solid var(--card-border);
		border-radius: 1rem;
		padding: 1rem;
	}
	h2 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.store {
		font-size: 0.68rem;
		color: var(--ink-dim);
		font-weight: 400;
	}
	.tabs {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.7rem;
	}
	.tabs button {
		border: 1px solid var(--card-border);
		background: transparent;
		color: var(--ink);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		cursor: pointer;
		text-transform: capitalize;
	}
	.tabs button.active {
		background: var(--accent);
		color: #14100c;
		font-weight: 700;
		border-color: var(--accent);
	}
	.board {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}
	.board li {
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
	}
	.rank {
		color: var(--ink-dim);
		width: 2rem;
	}
	.who {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.score {
		font-weight: 800;
	}
	.hint {
		color: var(--ink-dim);
		font-size: 0.85rem;
	}
	.submit {
		margin-top: 0.8rem;
		border-top: 1px dashed var(--card-border);
		padding-top: 0.6rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.7rem;
		border-radius: 0.6rem;
		border: 1px solid var(--card-border);
		background: var(--bg);
		color: var(--ink);
	}
	.row button {
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		border: none;
		background: var(--accent);
		color: #14100c;
		font-weight: 700;
		cursor: pointer;
	}
	.row button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
