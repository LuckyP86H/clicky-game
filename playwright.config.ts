import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 60_000,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure'
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
		{
			name: 'mobile',
			use: { ...devices['Pixel 7'] },
			testMatch: /responsive\.spec\.ts/
		}
	],
	webServer: {
		command: 'bun run build && bun x wrangler dev --port 4173 --local',
		url: 'http://localhost:4173',
		timeout: 240_000,
		reuseExistingServer: false
	}
});
