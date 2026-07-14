import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// Tiny stale-while-revalidate cache for server data (logs, analytics,
// tables). Paginated server data does NOT belong in reducers — this hook is
// the designated home for it.

interface CacheEntry {
  data: unknown;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const STALE_MS = 15_000;

export function invalidateQueries(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function useQuery<T>(path: string | null): {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | undefined>(() =>
    path && cache.has(path) ? (cache.get(path)!.data as T) : undefined,
  );
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path && !cache.has(path));
  const pathRef = useRef(path);
  pathRef.current = path;

  const fetchNow = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const result = await api<T>(p);
      cache.set(p, { data: result, at: Date.now() });
      if (pathRef.current === p) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (pathRef.current === p) setError(err as Error);
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    const cached = cache.get(path);
    if (cached) {
      setData(cached.data as T);
      setLoading(false);
      if (Date.now() - cached.at < STALE_MS) return;
    } else {
      setData(undefined);
      setLoading(true);
    }
    void fetchNow();
  }, [path, fetchNow]);

  return { data, error, loading, refetch: fetchNow };
}
