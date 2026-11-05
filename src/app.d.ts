// See https://svelte.dev/docs/kit/types#app.d.ts for information about these files
declare global {
	namespace App {
		interface Platform {
			env?: Record<string, string | undefined>;
			context?: ExecutionContext;
			caches?: CacheStorage;
		}
	}
}

export {};
