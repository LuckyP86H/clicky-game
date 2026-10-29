import { hashSeed } from '../rng';
import type { GameEventType, Mode } from '../types';
import { type FetchFn, globalFetch } from './fetch';
import { judgeWithFallback } from './jev';

/**
 * The AI host: a commentator who reacts to gameplay.
 *
 * Two layers, deliberately separate:
 *  - JUDGMENT (Jev, see jev.ts): a System One judgment model picks the
 *    reaction — a Choice over tone (teasing / encouraging / dramatic) and a
 *    Score for how dramatic the moment is. Jev returns probabilities, never
 *    text. Without TYPESAFE_API_KEY the deterministic demo judge answers
 *    instead, and every response names the judge that actually ran.
 *  - VOICE (this module): one interface (`HostAdapter`), three
 *    implementations that produce the actual sentence:
 *     - ScriptedHost — hand-written line banks (each line tagged with a
 *       tone, so the judgment layer's Choice selects among them). Default,
 *       labelled `demo`: it is a script, not a model, and the UI says so.
 *     - GeminiHost — Google Gemini via `GEMINI_API_KEY`.
 *     - OpenAICompatibleHost — any `/chat/completions` endpoint via
 *       `HOST_LLM_BASE_URL` / `HOST_LLM_API_KEY` / `HOST_LLM_MODEL`.
 *
 * Model adapters are best-effort: on any failure (network, quota, bad shape)
 * the caller falls back to the scripted host, and the returned `adapter` name
 * always says which one actually produced the line. Model output is treated
 * as untrusted display text: markup stripped, length capped.
 */

export interface HostContext {
	event: GameEventType;
	mode: Mode;
	score: number;
	streak: number;
	remaining: number;
	cardTitle?: string;
	deckName?: string;
}

export type HostTone = 'teasing' | 'encouraging' | 'dramatic';

export interface HostAdapter {
	readonly name: string;
	/** `tone` is the judgment layer's Choice; voices honour it when given. */
	comment(ctx: HostContext, tone?: HostTone): Promise<string>;
}

/* ------------------------------------------------------------------ */
/* Scripted (demo) host                                                 */
/* ------------------------------------------------------------------ */

interface TonedLine {
	tone: HostTone;
	text: string;
}

const LINES: Record<GameEventType, readonly TonedLine[]> = {
	start: [
		{
			tone: 'encouraging',
			text: 'New run, fresh board. Click every card exactly once — I believe in you.'
		},
		{ tone: 'teasing', text: 'The board is shuffled and so is my confidence. Let’s go.' },
		{ tone: 'dramatic', text: 'Twelve cards, zero repeats allowed. Off you pop.' }
	],
	hit: [
		{ tone: 'encouraging', text: 'Clean click. The board shuffles, the streak grows.' },
		{ tone: 'teasing', text: 'That’s a new one — nicely spotted.' },
		{ tone: 'dramatic', text: 'Smooth. Your memory is doing push-ups today.' }
	],
	streak: [
		{ tone: 'teasing', text: 'Streak building! The cards are starting to sweat.' },
		{ tone: 'encouraging', text: 'On a roll — keep that rhythm.' },
		{ tone: 'dramatic', text: 'Look at you, dealing out clicks like a card sharp.' }
	],
	nearmiss: [
		{ tone: 'dramatic', text: 'ONE card left. Breathe. You know the one.' },
		{ tone: 'encouraging', text: 'So close I can taste it. Pick the card you have NOT touched.' },
		{ tone: 'teasing', text: 'Final card territory — no pressure. (Some pressure.)' }
	],
	bust: [
		{
			tone: 'teasing',
			text: 'Ouch — that one was already clicked. The deck forgives you. I’m working on it.'
		},
		{ tone: 'dramatic', text: 'A repeat! The run ends, but the legend grows.' },
		{ tone: 'encouraging', text: 'Double-clicked. Classic. Shake it off and run it back.' }
	],
	win: [
		{ tone: 'dramatic', text: 'A perfect run! Every card exactly once. Frame it.' },
		{ tone: 'encouraging', text: 'Flawless memory. The critters salute you.' },
		{ tone: 'teasing', text: 'You win! I’ll pretend I helped.' }
	],
	timeup: [
		{ tone: 'teasing', text: 'Time! The clock wins this round — your score stands.' },
		{ tone: 'encouraging', text: 'Buzzer beater denied. Solid run against the clock.' },
		{ tone: 'dramatic', text: 'Out of time, never out of style.' }
	]
};

export class ScriptedHost implements HostAdapter {
	readonly name = 'demo';
	async comment(ctx: HostContext, tone?: HostTone): Promise<string> {
		const bank = LINES[ctx.event];
		// With a tone from the judgment layer, pick among that tone's lines;
		// without one, pick from the whole bank. Either way the pick is
		// deterministic from context — tests stay stable, no mocked randomness.
		const pool = tone ? bank.filter((l) => l.tone === tone) : bank;
		const lines = pool.length > 0 ? pool : bank;
		const idx =
			hashSeed(`${ctx.event}:${ctx.score}:${ctx.streak}:${ctx.cardTitle ?? ''}:${tone ?? ''}`) %
			lines.length;
		return (lines[idx] as TonedLine).text;
	}
}

/* ------------------------------------------------------------------ */
/* Model adapters                                                       */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT =
	'You are the host of a memory card game. Reply with ONE short, playful sentence (max 140 characters) reacting to the game event described. No markdown, no quotes, no emojis.';

function userPrompt(ctx: HostContext, tone?: HostTone): string {
	const parts = [
		`Event: ${ctx.event}.`,
		`Mode: ${ctx.mode}.`,
		`Score: ${ctx.score}.`,
		`Cards remaining: ${ctx.remaining}.`
	];
	if (tone) parts.push(`Tone: ${tone}.`);
	if (ctx.cardTitle) parts.push(`Last clicked card: ${ctx.cardTitle}.`);
	if (ctx.deckName) parts.push(`Deck: ${ctx.deckName}.`);
	return parts.join(' ');
}

/** Model output is untrusted display text: strip markup, cap length. */
export function sanitizeLine(raw: string): string {
	return raw
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 140);
}

export class GeminiHost implements HostAdapter {
	readonly name = 'gemini';
	private apiKey: string;
	private model: string;
	private fetchFn: FetchFn;

	constructor(apiKey: string, model = 'gemini-2.0-flash', fetchFn: FetchFn = globalFetch) {
		this.apiKey = apiKey;
		this.model = model;
		this.fetchFn = fetchFn;
	}

	async comment(ctx: HostContext, tone?: HostTone): Promise<string> {
		const res = await this.fetchFn(
			`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
					contents: [{ parts: [{ text: userPrompt(ctx, tone) }] }],
					generationConfig: { maxOutputTokens: 60, temperature: 0.9 }
				}),
				signal: AbortSignal.timeout(5_000)
			}
		);
		if (!res.ok) throw new Error(`Gemini request failed: HTTP ${res.status}`);
		const data = (await res.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
		};
		const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
		const line = sanitizeLine(text);
		if (!line) throw new Error('Gemini returned an empty line');
		return line;
	}
}

export class OpenAICompatibleHost implements HostAdapter {
	readonly name = 'openai-compatible';
	private baseUrl: string;
	private apiKey: string;
	private model: string;
	private fetchFn: FetchFn;

	constructor(baseUrl: string, apiKey: string, model: string, fetchFn: FetchFn = globalFetch) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.apiKey = apiKey;
		this.model = model;
		this.fetchFn = fetchFn;
	}

	async comment(ctx: HostContext, tone?: HostTone): Promise<string> {
		const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
			body: JSON.stringify({
				model: this.model,
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: userPrompt(ctx, tone) }
				],
				max_tokens: 60,
				temperature: 0.9
			}),
			signal: AbortSignal.timeout(5_000)
		});
		if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status}`);
		const data = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const line = sanitizeLine(data.choices?.[0]?.message?.content ?? '');
		if (!line) throw new Error('LLM returned an empty line');
		return line;
	}
}

/* ------------------------------------------------------------------ */
/* Selection                                                            */
/* ------------------------------------------------------------------ */

export interface HostEnv {
	GEMINI_API_KEY?: string;
	GEMINI_MODEL?: string;
	HOST_LLM_BASE_URL?: string;
	HOST_LLM_API_KEY?: string;
	HOST_LLM_MODEL?: string;
	TYPESAFE_API_KEY?: string;
	TYPESAFE_BASE_URL?: string;
	TYPESAFE_MODEL?: string;
}

/** Gemini if keyed, else OpenAI-compatible if fully configured, else scripted. */
export function getHost(env: HostEnv): HostAdapter {
	if (env.GEMINI_API_KEY) return new GeminiHost(env.GEMINI_API_KEY, env.GEMINI_MODEL);
	if (env.HOST_LLM_BASE_URL && env.HOST_LLM_API_KEY && env.HOST_LLM_MODEL) {
		return new OpenAICompatibleHost(
			env.HOST_LLM_BASE_URL,
			env.HOST_LLM_API_KEY,
			env.HOST_LLM_MODEL
		);
	}
	return new ScriptedHost();
}

/* ------------------------------------------------------------------ */
/* Jev judgment layer                                                   */
/* ------------------------------------------------------------------ */

export interface HostJudgment {
	tone: HostTone;
	/** Score answer normalised to 0..1 across the drama rubric. */
	drama: number;
	/** Which judge actually answered: the real TypeSafe model or the demo judge. */
	judge: 'typesafe' | 'demo';
}

const TONE_OPTIONS: readonly HostTone[] = ['teasing', 'encouraging', 'dramatic'];
const DRAMA_LEVELS: readonly string[] = [
	'Routine play — nothing is decided yet',
	'Tension building — the run could turn here',
	'Climactic — this moment decides the run'
];

/**
 * One Jev request, two judgments about the same run state: a Choice over
 * the host's tone and a Score for how dramatic the moment is. Jev never
 * writes the line — it decides HOW the voice should speak, and the voice
 * (scripted bank or text model) does the speaking.
 */
export async function judgeHostMoment(
	env: HostEnv,
	ctx: HostContext,
	fetchFn: FetchFn = globalFetch
): Promise<HostJudgment> {
	const { answers, judge } = await judgeWithFallback(
		{
			TYPESAFE_API_KEY: env.TYPESAFE_API_KEY,
			TYPESAFE_BASE_URL: env.TYPESAFE_BASE_URL,
			TYPESAFE_MODEL: env.TYPESAFE_MODEL
		},
		{
			event: ctx.event,
			mode: ctx.mode,
			score: ctx.score,
			streak: ctx.streak,
			remaining: ctx.remaining
		},
		{
			tone: {
				type: 'choice',
				instructions: 'Which tone should the game host use when reacting to `event`?',
				criteria: {
					teasing: 'Playful ribbing, light mockery',
					encouraging: 'Warm, supportive, cheering the player on',
					dramatic: 'High-stakes sports-announcer energy'
				}
			},
			drama: {
				type: 'score',
				instructions: 'How dramatic is this moment in the run?',
				criteria: [...DRAMA_LEVELS]
			}
		},
		fetchFn
	);
	const toneAns = answers.tone;
	const tone: HostTone =
		toneAns?.type === 'choice' && (TONE_OPTIONS as readonly string[]).includes(toneAns.choice)
			? (toneAns.choice as HostTone)
			: 'encouraging';
	const dramaAns = answers.drama;
	const drama =
		dramaAns?.type === 'score'
			? Math.round((dramaAns.score / (DRAMA_LEVELS.length - 1)) * 100) / 100
			: 0;
	return { tone, drama, judge };
}

export interface HostComment extends HostJudgment {
	line: string;
	adapter: string;
}

/**
 * Full comment flow: Jev judges the moment (tone + drama), the selected
 * voice speaks in that tone. Model failure ⇒ scripted line, labelled demo;
 * Jev failure ⇒ demo judge, labelled demo. Nothing is ever oversold.
 */
export async function hostComment(
	env: HostEnv,
	ctx: HostContext,
	fetchFn: FetchFn = globalFetch
): Promise<HostComment> {
	const judgment = await judgeHostMoment(env, ctx, fetchFn);
	const host = getHost(env);
	try {
		return { line: await host.comment(ctx, judgment.tone), adapter: host.name, ...judgment };
	} catch {
		const demo = new ScriptedHost();
		return { line: await demo.comment(ctx, judgment.tone), adapter: demo.name, ...judgment };
	}
}
