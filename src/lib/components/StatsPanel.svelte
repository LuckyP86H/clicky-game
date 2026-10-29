<script lang="ts">
import type { HistoryEntry } from '#lib/client/profile.js';
import { computeStats } from '#lib/client/stats.js';

interface Props {
	history: readonly HistoryEntry[];
	today: string;
}

let { history, today }: Props = $props();

const stats = $derived(computeStats(history, today));

/** Sparkline points for the recent-form scores, scaled to a 120×32 box. */
const sparkPoints = $derived.by(() => {
	const form = stats.recentForm;
	if (form.length < 2) return '';
	const max = Math.max(...form, 1);
	return form
		.map(
			(v, i) =>
				`${((i / (form.length - 1)) * 116 + 2).toFixed(1)},${(30 - (v / max) * 26).toFixed(1)}`
		)
		.join(' ');
});

const trendText = $derived(
	stats.totalRuns < 10
		? 'Play 10 runs to unlock your form trend.'
		: stats.trendDelta > 0.05
			? `Trending up: +${stats.trendDelta.toFixed(1)} vs your previous 5 runs.`
			: stats.trendDelta < -0.05
				? `Cooling off: ${stats.trendDelta.toFixed(1)} vs your previous 5 runs.`
				: 'Holding steady across your last 10 runs.'
);
</script>

<section class="stats" aria-label="Your memory-training stats" data-testid="stats-panel">
	<h3>Memory training</h3>
	<div class="tiles">
		<div class="tile">
			<span class="value" data-testid="stat-total">{stats.totalRuns}</span>
			<span class="label">total runs</span>
		</div>
		<div class="tile">
			<span class="value">{Math.round(stats.winRate * 100)}%</span>
			<span class="label">win rate</span>
		</div>
		<div class="tile">
			<span class="value">{stats.averageScore.toFixed(1)}</span>
			<span class="label">avg score</span>
		</div>
		<div class="tile">
			<span class="value">{stats.bestScore}</span>
			<span class="label">best score</span>
		</div>
		<div class="tile">
			<span class="value">{stats.runsLast7Days}</span>
			<span class="label">runs this week</span>
		</div>
		<div class="tile">
			<span class="value">{stats.dailyStreakDays > 1 ? '🔥 ' : ''}{stats.dailyStreakDays}</span>
			<span class="label">daily streak (days)</span>
		</div>
	</div>
	<p class="trend" data-testid="stat-trend">{trendText}</p>
	{#if sparkPoints}
		<svg class="spark" viewBox="0 0 120 32" role="img" aria-label="Score trend of your last runs">
			<polyline points={sparkPoints} fill="none" stroke="var(--accent)" stroke-width="2" />
		</svg>
		<p class="hint">Your last {stats.recentForm.length} runs, oldest → newest.</p>
	{/if}
</section>

<style>
	.stats {
		margin-top: 1rem;
		background: var(--panel);
		border: 1px solid var(--card-border);
		border-radius: 1rem;
		padding: 1rem;
	}
	h3 {
		margin: 0 0 0.7rem;
		font-size: 1rem;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.5rem 0.3rem;
		border-radius: 0.7rem;
		background: var(--bg);
	}
	.value {
		font-size: 1.25rem;
		font-weight: 800;
	}
	.label {
		font-size: 0.7rem;
		color: var(--ink-dim);
		text-align: center;
	}
	.trend {
		margin: 0.7rem 0 0;
		font-size: 0.9rem;
	}
	.spark {
		width: 100%;
		height: 40px;
		margin-top: 0.4rem;
	}
	.hint {
		color: var(--ink-dim);
		font-size: 0.78rem;
		margin: 0.2rem 0 0;
	}
</style>
