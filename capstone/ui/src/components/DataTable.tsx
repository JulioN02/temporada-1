import type { ReactNode } from 'react'
import { EmptyState } from './EmptyState.tsx'
import { ErrorState } from './ErrorState.tsx'
import { LoadingState } from './LoadingState.tsx'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
}

/**
 * Generic table with built-in loading / empty / error slots (R-UI-FND-3).
 * Without a `render` fn the cell defaults to `row[key]` stringified — the
 * key must exist on the row in that case. `onRetry` re-fetches on error.
 */
export function DataTable<T>({
  columns,
  rows,
  keyOf,
  loading = false,
  error = null,
  emptyMessage,
  onRetry,
}: {
  columns: readonly Column<T>[]
  rows: readonly T[]
  keyOf: (row: T) => string
  loading?: boolean
  error?: string | null
  emptyMessage?: string
  onRetry?: () => void
}) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (rows.length === 0) return <EmptyState message={emptyMessage} />

  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={keyOf(row)}>
            {columns.map((column) => {
              const cell = column.render
                ? column.render(row)
                : String((row as Record<string, unknown>)[column.key] ?? '')
              return <td key={column.key}>{cell}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}