import { useState } from 'react'

/**
 * Pagination state helpers (page/limit + bounded navigation). The caller
 * feeds `page`/`limit` into the list API params and `totalPages` back into
 * the Pagination component.
 */
export function usePagination(initial: { page?: number; limit?: number } = {}) {
  const [page, setPage] = useState(initial.page ?? 1)
  const [limit, setLimit] = useState(initial.limit ?? 20)

  return {
    page,
    limit,
    setPage,
    setLimit,
    next: () => setPage((current) => current + 1),
    prev: () => setPage((current) => Math.max(1, current - 1)),
    reset: () => setPage(1),
  }
}