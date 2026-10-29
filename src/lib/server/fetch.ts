/**
 * The Workers runtime's global `fetch` throws "Illegal invocation" when it is
 * passed around and called unbound (its `this` must be the global scope).
 * Every server module therefore defaults to this wrapper instead of a bare
 * `fetch` reference: the arrow calls `globalThis.fetch(...)`, which keeps the
 * receiver correct in workerd, Node, and tests alike.
 */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const globalFetch: FetchFn = (input, init) => globalThis.fetch(input, init);
