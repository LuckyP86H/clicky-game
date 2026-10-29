import { defineConfig } from 'vitest/config';

// Unit tests cover the pure modules (engine, curator, leaderboard, host,
// profile) and import them by relative path — no SvelteKit plugin needed,
// which keeps the test run fast and independent of the app build.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
