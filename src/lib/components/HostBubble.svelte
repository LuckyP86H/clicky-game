<script lang="ts">
interface Props {
	line: string | null;
	adapter: string | null;
	/** Jev judgment that selected this line's tone (see server/host.ts). */
	judgment?: { judge: string; tone: string; drama: number } | null;
}

let { line, adapter, judgment = null }: Props = $props();
</script>

{#if line}
	<aside class="host" aria-live="polite" data-testid="host-bubble">
		<span class="avatar" aria-hidden="true">🎙️</span>
		<p class="line">{line}</p>
		{#if adapter}
			<span class="badge" title="Which host produced this line">
				{adapter === 'demo' ? 'demo host (scripted)' : `host: ${adapter}`}
			</span>
		{/if}
		{#if judgment}
			<span
				class="badge"
				title="Jev (a judgment model) picked the tone; drama is its 0–1 score for the moment"
			>
				{judgment.judge === 'demo' ? 'Jev demo judge' : 'Jev'} · {judgment.tone} · drama
				{judgment.drama.toFixed(2)}
			</span>
		{/if}
	</aside>
{/if}

<style>
	.host {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		padding: 0.65rem 0.9rem;
		border-radius: 0.9rem;
		background: var(--panel);
		border: 1px solid var(--card-border);
	}
	.avatar {
		font-size: 1.3rem;
	}
	.line {
		margin: 0;
		flex: 1;
		font-size: 0.95rem;
	}
	.badge {
		font-size: 0.68rem;
		color: var(--ink-dim);
		border: 1px solid var(--card-border);
		border-radius: 999px;
		padding: 0.15rem 0.5rem;
		white-space: nowrap;
	}
</style>
