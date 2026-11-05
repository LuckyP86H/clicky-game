import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// SvelteKit 3 takes its configuration through the Vite plugin —
// there is no svelte.config.js anymore. The lib alias is `#lib`,
// declared as a subpath import in package.json ("imports").
export default defineConfig({
	plugins: [sveltekit({ adapter: adapter() })]
});
