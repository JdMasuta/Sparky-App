// Tiny stale-while-revalidate cache for the Admin section. The cache lives at
// module scope so it survives Admin's tab switches (each tab unmounts and
// remounts its section component). Keys are the API paths themselves, so the
// fetcher is always `api.get(key)` and invalidation can refetch on its own.
//
// Semantics:
//  - fresh (fetchedAt within ttl): serve from cache, no request
//  - stale: serve cached data immediately, revalidate in the background
//  - missing/forced: fetch, deduping concurrent requests for the same key
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api.js";

const cache = new Map(); // key -> { data, error, fetchedAt, promise }
const listeners = new Map(); // key -> Set<callback>

const EMPTY = { data: undefined, error: null, fetchedAt: 0, promise: null };

const readEntry = (key) => cache.get(key) ?? EMPTY;

function setEntry(key, patch) {
  cache.set(key, { ...readEntry(key), ...patch });
  for (const fn of listeners.get(key) ?? []) fn();
}

function subscribe(key, fn) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

export function fetchCached(key, ttlMs, { force = false } = {}) {
  const entry = readEntry(key);
  const fresh = entry.fetchedAt && Date.now() - entry.fetchedAt < ttlMs;
  if (fresh && !force) return Promise.resolve(entry.data);
  if (entry.promise) return entry.promise;

  const promise = api
    .get(key)
    .then((data) => {
      setEntry(key, { data, error: null, fetchedAt: Date.now(), promise: null });
      return data;
    })
    .catch((error) => {
      setEntry(key, { error, promise: null });
      throw error;
    });
  setEntry(key, { promise });
  return promise;
}

// Mark keys stale. Keys with mounted subscribers refetch immediately; the rest
// refetch on next mount.
export function invalidate(...keys) {
  for (const key of keys) {
    if (!cache.has(key)) continue;
    setEntry(key, { fetchedAt: 0 });
    if (listeners.get(key)?.size) {
      fetchCached(key, 0, { force: true }).catch(() => {});
    }
  }
}

// Update a cached list in place (e.g. from a mutation response) without a
// refetch. No-op if the key has never been fetched.
export function patchList(key, updater) {
  const entry = cache.get(key);
  if (!entry || entry.data === undefined) return;
  setEntry(key, { data: updater(entry.data) });
}

export function useCachedGet(key, { ttl = 30_000 } = {}) {
  const snapshot = useSyncExternalStore(
    useCallback((fn) => subscribe(key, fn), [key]),
    () => readEntry(key),
  );

  useEffect(() => {
    fetchCached(key, ttl).catch(() => {}); // errors surface via snapshot.error
  }, [key, ttl]);

  const refresh = useCallback(() => fetchCached(key, ttl, { force: true }), [key, ttl]);

  return {
    data: snapshot.data,
    error: snapshot.error,
    loading: snapshot.data === undefined && !snapshot.error,
    refresh,
  };
}
