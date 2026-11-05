import type { CardDef, Deck } from './types';

/**
 * Bundled decks. Every card uses generated art (`artSeed`) — original SVG
 * critters drawn by src/lib/art.ts. No external images, no hotlinks.
 */

function critter(id: string, title: string): CardDef {
	return { id, title, artSeed: id };
}

export const CRITTERS: CardDef[] = [
	critter('nebula-newt', 'Nebula Newt'),
	critter('astro-axolotl', 'Astro Axolotl'),
	critter('comet-capybara', 'Comet Capybara'),
	critter('lunar-lemur', 'Lunar Lemur'),
	critter('orbit-otter', 'Orbit Otter'),
	critter('pulsar-panda', 'Pulsar Panda'),
	critter('quasar-quokka', 'Quasar Quokka'),
	critter('rocket-raccoon', 'Rocket Raccoon'),
	critter('solar-sloth', 'Solar Sloth'),
	critter('meteor-mole', 'Meteor Mole'),
	critter('astro-armadillo', 'Astro Armadillo'),
	critter('cosmo-koala', 'Cosmo Koala')
];

/** Extra critters so the Daily Challenge can pick a fresh 12 from a pool of 18. */
export const DAILY_POOL: CardDef[] = [
	...CRITTERS,
	critter('void-vole', 'Void Vole'),
	critter('zephyr-zebra', 'Zephyr Zebra'),
	critter('ion-iguana', 'Ion Iguana'),
	critter('nova-narwhal', 'Nova Narwhal'),
	critter('echo-echidna', 'Echo Echidna'),
	critter('gamma-gecko', 'Gamma Gecko')
];

export const DEFAULT_DECK: Deck = {
	id: 'cosmic-critters',
	name: 'Cosmic Critters',
	source: 'builtin',
	cards: CRITTERS
};

/* ------------------------------------------------------------------ */
/* Demo decks for the curator's offline/demo adapter.                   */
/* ------------------------------------------------------------------ */

interface DemoTheme {
	keywords: string[];
	name: string;
	cards: CardDef[];
}

const DEMO_THEMES: DemoTheme[] = [
	{
		keywords: ['ocean', 'sea', 'deep sea', 'fish', 'underwater', 'marine'],
		name: 'Deep Sea Daydream',
		cards: [
			critter('demo-abyss-angler', 'Abyss Angler'),
			critter('demo-coral-clown', 'Coral Clown'),
			critter('demo-drift-jelly', 'Drift Jelly'),
			critter('demo-kelp-kid', 'Kelp Kid'),
			critter('demo-lantern-eel', 'Lantern Eel'),
			critter('demo-manta-ray', 'Manta Ray'),
			critter('demo-pearl-oyster', 'Pearl Oyster'),
			critter('demo-reef-rider', 'Reef Rider'),
			critter('demo-sand-dollar', 'Sand Dollar'),
			critter('demo-tide-turtle', 'Tide Turtle'),
			critter('demo-wave-whale', 'Wave Whale'),
			critter('demo-bubble-crab', 'Bubble Crab')
		]
	},
	{
		keywords: ['forest', 'wood', 'tree', 'jungle', 'nature'],
		name: 'Forest Friends',
		cards: [
			critter('demo-moss-mouse', 'Moss Mouse'),
			critter('demo-fern-fox', 'Fern Fox'),
			critter('demo-acorn-squirrel', 'Acorn Squirrel'),
			critter('demo-bark-beetle', 'Bark Beetle'),
			critter('demo-pine-marten', 'Pine Marten'),
			critter('demo-shade-shrew', 'Shade Shrew'),
			critter('demo-leaf-frog', 'Leaf Frog'),
			critter('demo-birch-badger', 'Birch Badger'),
			critter('demo-owl-owlet', 'Owl Owlet'),
			critter('demo-hedge-hog', 'Hedge Hog'),
			critter('demo-stump-toad', 'Stump Toad'),
			critter('demo-vine-viper', 'Vine Viper')
		]
	},
	{
		keywords: ['space', 'star', 'planet', 'galaxy', 'rocket', 'alien'],
		name: 'Far-Out Voyagers',
		cards: [
			critter('demo-star-skipper', 'Star Skipper'),
			critter('demo-moon-moth', 'Moon Moth'),
			critter('demo-orbit-owl', 'Orbit Owl'),
			critter('demo-comet-cat', 'Comet Cat'),
			critter('demo-astro-bat', 'Astro Bat'),
			critter('demo-solar-seal', 'Solar Seal'),
			critter('demo-void-vervet', 'Void Vervet'),
			critter('demo-lunar-lark', 'Lunar Lark'),
			critter('demo-pulsar-pup', 'Pulsar Pup'),
			critter('demo-nebula-numbat', 'Nebula Numbat'),
			critter('demo-quasar-quail', 'Quasar Quail'),
			critter('demo-eclipse-elk', 'Eclipse Elk')
		]
	},
	{
		keywords: ['food', 'snack', 'dessert', 'fruit', 'sweet', 'kitchen'],
		name: 'Snack Attack',
		cards: [
			critter('demo-donut-dodo', 'Donut Dodo'),
			critter('demo-muffin-mouse', 'Muffin Mouse'),
			critter('demo-peach-pig', 'Peach Pig'),
			critter('demo-taco-turtle', 'Taco Turtle'),
			critter('demo-waffle-wolf', 'Waffle Wolf'),
			critter('demo-berry-bear', 'Berry Bear'),
			critter('demo-noodle-newt', 'Noodle Newt'),
			critter('demo-pickle-pup', 'Pickle Pup'),
			critter('demo-cocoa-crab', 'Cocoa Crab'),
			critter('demo-lemon-lynx', 'Lemon Lynx'),
			critter('demo-sushi-shiba', 'Sushi Shiba'),
			critter('demo-pudding-puffin', 'Pudding Puffin')
		]
	}
];

/** The demo source's deck for a theme: keyword match, else the default deck re-labelled. */
export function demoDeckForTheme(theme: string): Deck {
	const lower = theme.toLowerCase();
	const match = DEMO_THEMES.find((t) => t.keywords.some((k) => lower.includes(k)));
	if (match) {
		return {
			id: `demo-${match.cards[0]?.id ?? 'deck'}`,
			name: match.name,
			source: 'demo',
			notice: 'Demo deck — offline art set matched to your theme (no live image search was used).',
			cards: match.cards
		};
	}
	return {
		id: 'demo-cosmic-critters',
		name: 'Cosmic Critters (demo pick)',
		source: 'demo',
		notice:
			'Demo deck — the live image search was unavailable, so the curator fell back to a bundled art set.',
		cards: CRITTERS
	};
}
