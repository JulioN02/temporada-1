import { useEffect, useState } from 'react'

export interface UseResourceResult<T> {
  data: T | null
  loading: boolean
  error: unknown
  refetch: () => void
}

/**
 * Small data-fetching hook (design ADR-1 — plain hooks + context, no TanStack
 * Query; page data with on-demand refresh). `deps` mirrors useMemo-style
 * dependencies (page, filters): the effect re-runs when they change;
 * `refetch()` forces a reload. A cancellation flag guards against state
 * updates after unmount.
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // deps are caller-owned (page/filters); refetch bumps `attempt`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  function refetch(): void {
    setAttempt((current) => current + 1)
  }

  return { data, loading, error, refetch }
}