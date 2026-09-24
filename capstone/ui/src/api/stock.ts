import { api, buildQuery } from './client.ts'
import type {
  AdjustMovementInput,
  Movement,
  MovementListItem,
  MovementType,
  MovementWriteResponse,
  Paginated,
  StockLevelsResponse,
  TransferInput,
} from './types.ts'

/**
 * Stock API module (it4 showpiece). DOCUMENTED ENVELOPE DEVIATION: getStock
 * returns `{items: StockRow[]}` (snake_case rows, no pagination) — typed
 * explicitly; pagination helpers are never applied to it (design ADR-5).
 */
export type StockQueryParams = {
  productId?: string | undefined
  warehouseId?: string | undefined
}

export type MovementsListParams = {
  productId?: string | undefined
  type?: MovementType | undefined
  page?: number | undefined
  limit?: number | undefined
}

export function getStock(params: StockQueryParams = {}): Promise<StockLevelsResponse> {
  return api.get<StockLevelsResponse>(`/api/stock${buildQuery(params)}`)
}

export function listMovements(params: MovementsListParams = {}): Promise<Paginated<MovementListItem>> {
  return api.get<Paginated<MovementListItem>>(`/api/stock/movements${buildQuery(params)}`)
}

/**
 * R-STK-3/6: adjustment with a FRESH Idempotency-Key per submit; replay
 * returns 200 with the same movement (postWithStatus exposes the signal).
 * The backend locks `type` to 'adjustment' on this endpoint — the client
 * injects it (callers never choose).
 */
export function adjust(
  input: AdjustMovementInput,
  idempotencyKey: string,
): Promise<{ status: number; data: MovementWriteResponse }> {
  return api.postWithStatus<MovementWriteResponse>(
    '/api/stock/movements',
    { ...input, type: 'adjustment' },
    { 'Idempotency-Key': idempotencyKey },
  )
}

/** R-STK-4/6: transfer with a fresh Idempotency-Key per submit. */
export function transfer(
  input: TransferInput,
  idempotencyKey: string,
): Promise<{ status: number; data: MovementWriteResponse }> {
  return api.postWithStatus<MovementWriteResponse>('/api/stock/transfers', input, {
    'Idempotency-Key': idempotencyKey,
  })
}

export type { Movement }