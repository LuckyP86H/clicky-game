<script lang="ts">
import type { Deck } from '#lib/types.js';

interface Props {
	onplay: (deck: Deck) => void;
}

let { onplay }: Props = $props();

let theme = $state('');
let running = $state(false);
let steps = $state<string[]>([]);
let readyDeck = $state<Deck | null>(null);
let error = $state<string | null>(null);

function describeEvent(event: { type: string; [k: string]: unknown }): string | null {
	switch (event.type) {
		case 'plan':
			return event.judge
				? `Planning a deck for “${String(event.theme)}”… Candidates will be gated by the ${event.judge === 'demo' ? 'demo judge (Jev heuristics)' : 'Jev judgment model'} at a 0.70 probability bar.`
				: `Planning a deck for “${String(event.theme)}”…`;
		case 'search':
			return `Searching ${String(event.source)} for “${String(event.query)}”…`;
		case 'validate':
			return `Validated images: ${String(event.accepted)} accepted, ${String(event.rejected)} rejected.`;
		case 'fallback':
			return `Live material ran short (${String(event.reason)}). Falling back to a demo deck.`;
		case 'done':
			return 'Deck assembled.';
		default:
			return null;
	}
}

async function curate() {
	const trimmed = theme.trim();
	if (!trimmed || running) return;
	running = true;
	steps = [];
	readyDeck = null;
	error = null;
	try {
		const res = await fetch('/api/curate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ theme: trimmed })
		});
		if (!res.ok || !res.body) throw new Error(`curator request failed (${res.status})`);
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const chunks = buffer.split('\n\n');
			buffer = chunks.pop() ?? '';
			for (const chunk of chunks) {
				const line = chunk.split('\n').find((l) => l.startsWith('data:'));
				if (!line) continue;
				const event = JSON.parse(line.slice(5)) as { type: string; [k: string]: unknown };
				const text = describeEvent(event);
				if (text) steps = [...steps, text];
				if (event.type === 'done') readyDeck = event.deck as Deck;
				if (event.type === 'error') error = String(event.message ?? 'curation failed');
			}
		}
	} catch (err) {
		error = err instanceof Error ? err.message : 'curation failed';
	} finally {
		running = false;
	}
}
</script>

<section class="panel" aria-labelledby="curator-heading">
	<h2 id="curator-heading">AI deck curator</h2>
	<p class="hint">
		Type a theme and the curator agent searches for openly-licensed photos, validates them, and has
		the Jev judgment model gate each candidate (on-theme? family-appropriate?) before building your
		deck. Offline, it honestly falls back to a labelled demo deck.
	</p>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void curate();
		}}
	>
		<label class="visually-hidden" for="theme-input">Deck theme</label>
		<input
			id="theme-input"
			data-testid="theme-input"
			type="text"
			maxlength="60"
			placeholder="deep sea animals"
			bind:value={theme}
			disabled={running}
		/>
		<button type="submit" data-testid="curate-button" disabled={running || theme.trim().length === 0}>
			{running ? 'Curating…' : 'Build my deck'}
		</button>
	</form>
	{#if steps.length > 0}
		<ol class="steps" data-testid="curate-steps">
			{#each steps as step (step)}
				<li>{step}</li>
			{/each}
		</ol>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if readyDeck}
		<div class="ready" data-testid="deck-ready">
			<p>
				<strong>{readyDeck.name}</strong> — {readyDeck.cards.length} cards
				{#if readyDeck.source === 'demo'}<span class="demo-badge">demo deck</span>{/if}
			</p>
			{#if readyDeck.notice}<p class="hint">{readyDeck.notice}</p>{/if}
			{#if readyDeck.judge}
				<p class="hint" data-testid="judge-summary">
					Judged by {readyDeck.judge.kind === 'demo' ? 'the demo judge (Jev heuristics)' : 'Jev (TypeSafe)'}:
					{readyDeck.judge.accepted} of {readyDeck.judge.judged} gated candidates passed the 0.70
					bar · mean confidence {readyDeck.judge.meanConfidence.toFixed(2)}
				</p>
			{/if}
			<button type="button" data-testid="play-deck" onclick={() => readyDeck && onplay(readyDeck)}>
				Play this deck
			</button>
		</div>
	{/if}
</section>

<style>
	.panel {
		background: var(--panel);
		border: 1px solid var(--card-border);
		border-radius: 1rem;
		padding: 1rem;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}
	.hint {
		color: var(--ink-dim);
		font-size: 0.85rem;
		margin: 0.3rem 0 0.7rem;
	}
	form {
		display: flex;
		gap: 0.5rem;
	}
	input {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.7rem;
		border-radius: 0.6rem;
		border: 1px solid var(--card-border);
		background: var(--bg);
		color: var(--ink);
	}
	button {
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		border: none;
		background: var(--accent);
		color: #14100c;
		font-weight: 700;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.steps {
		margin: 0.7rem 0 0;
		padding-left: 1.2rem;
		font-size: 0.85rem;
		color: var(--ink-dim);
	}
	.error {
		color: #ff9d9d;
	}
	.ready {
		margin-top: 0.8rem;
		border-top: 1px dashed var(--card-border);
		padding-top: 0.7rem;
	}
	.demo-badge {
		font-size: 0.68rem;
		border: 1px solid var(--card-border);
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		color: var(--ink-dim);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
