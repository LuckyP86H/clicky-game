<script lang="ts">
import { critterSvg } from '#lib/art.js';
import type { CardDef } from '#lib/types.js';

interface Props {
	card: CardDef;
	disabled?: boolean;
	onpick: (id: string) => void;
}

let { card, disabled = false, onpick }: Props = $props();
</script>

<button
	type="button"
	class="card"
	data-testid="card"
	data-card-id={card.id}
	aria-label={card.title}
	{disabled}
	onclick={() => onpick(card.id)}
>
	{#if card.imageUrl}
		<img src={card.imageUrl} alt={card.title} loading="lazy" draggable="false" />
	{:else}
		<span class="art" aria-hidden="true">{@html critterSvg(card.artSeed ?? card.id)}</span>
	{/if}
	<span class="title">{card.title}</span>
	{#if card.attribution}
		<span class="credit">{card.attribution}</span>
	{/if}
</button>

<style>
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.6rem;
		border: 2px solid var(--card-border);
		border-radius: 1rem;
		background: var(--card-bg);
		color: var(--ink);
		cursor: pointer;
		transition:
			transform 140ms ease,
			border-color 140ms ease,
			box-shadow 140ms ease;
		-webkit-tap-highlight-color: transparent;
	}
	.card:hover:not(:disabled),
	.card:focus-visible {
		transform: translateY(-3px) scale(1.02);
		border-color: var(--accent);
		box-shadow: 0 10px 24px rgb(0 0 0 / 0.35);
		outline: none;
	}
	.card:active:not(:disabled) {
		transform: scale(0.97);
	}
	.card:disabled {
		cursor: default;
		opacity: 0.85;
	}
	.card img,
	.card .art :global(svg) {
		width: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: 0.65rem;
		display: block;
		user-select: none;
	}
	.title {
		font-weight: 700;
		font-size: 0.92rem;
		line-height: 1.15;
	}
	.credit {
		font-size: 0.62rem;
		color: var(--ink-dim);
		line-height: 1.2;
	}
</style>
