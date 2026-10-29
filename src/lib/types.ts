/** Shared domain types for Clickster. */

export type Mode = 'classic' | 'timed' | 'daily';

export const MODES: readonly Mode[] = ['classic', 'timed', 'daily'];

export function isMode(value: unknown): value is Mode {
	return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/**
 * One playable card. A card carries either a remote photo (`imageUrl`, used by
 * live-curated decks) or a generated-art seed (`artSeed`, used by the bundled
 * decks) — never both. `license`/`attribution` travel with curated photos so
 * the UI can credit the source.
 */
export interface CardDef {
	id: string;
	title: string;
	imageUrl?: string;
	artSeed?: string;
	license?: string;
	attribution?: string;
}

export type DeckSource = 'builtin' | 'openverse' | 'demo';

export interface Deck {
	id: string;
	name: string;
	source: DeckSource;
	/** Human-readable note shown with demo decks so nothing is oversold. */
	notice?: string;
	cards: CardDef[];
	/** Present when a Jev judgment layer gated this deck's candidates. */
	judge?: JudgeSummary;
}

/**
 * How the Jev judgment layer did on a curated deck. `kind` always names the
 * judge that actually answered: the real TypeSafe model, or the demo judge.
 */
export interface JudgeSummary {
	kind: 'typesafe' | 'demo';
	judged: number;
	accepted: number;
	/** Mean Choice confidence across judged candidates, 0..1. */
	meanConfidence: number;
}

export type RunStatus = 'playing' | 'won' | 'bust' | 'timeup';

export type GameEventType = 'start' | 'hit' | 'streak' | 'nearmiss' | 'bust' | 'win' | 'timeup';

export interface GameEvent {
	type: GameEventType;
	cardId?: string;
	cardTitle?: string;
	score: number;
	streak: number;
	remaining: number;
}

export interface RunState {
	mode: Mode;
	deckId: string;
	/** Base seed for this run; the shuffle after click n derives from (seed, n). */
	seed: number;
	/** Card ids in current display order. */
	order: string[];
	/** Card ids clicked so far in this run, in click order. */
	clicked: string[];
	score: number;
	status: RunStatus;
	/** Total clicks applied, bust click included. */
	clicks: number;
	startedAt: number;
	/** Timed mode only: epoch ms at which the run ends. */
	deadline?: number;
	lastEvent: GameEvent | null;
}

export interface ScoreEntry {
	name: string;
	score: number;
	mode: Mode;
	/** YYYY-MM-DD — required for daily boards, absent otherwise. */
	date?: string;
	/** Epoch ms of submission; also makes each Redis sorted-set member unique. */
	ts: number;
}
