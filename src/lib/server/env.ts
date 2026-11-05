/**
 * Runtime environment for server code.
 *
 * On Cloudflare the Worker's vars/secrets arrive on `platform.env`; in plain
 * Node contexts (tests, tooling) they are on `process.env`. Platform values
 * win. Returns a plain record so the adapter-selection helpers
 * (getLeaderboard/getHost) stay framework-free and unit-testable.
 */
export function readEnv(platform: App.Platform | undefined): Record<string, string | undefined> {
	const fromProcess: Record<string, string | undefined> =
		typeof process !== 'undefined' ? process.env : {};
	return { ...fromProcess, ...(platform?.env ?? {}) };
}
