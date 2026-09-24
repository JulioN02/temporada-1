import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import { parseOrThrow } from '../../middleware/validate.ts'
import type { CancelOrderInput, CreateOrderInput, OrdersListQuery } from './dto.ts'
import { ordersListQuerySchema } from './dto.ts'
import * as ordersService from './service.ts'

/**
 * Orders controller (T-3-5) — orchestration only, every endpoint ≤15 lines
 * (R-NFR-4). createOrder reads the Idempotency-Key header (R-ORD-4): replay →
 * 200 with the original order, new → 201.
 */
export interface OrdersController {
  createOrder: (req: Request, res: Response) => Promise<void>
  listOrders: (req: Request, res: Response) => Promise<void>
  getOrder: (req: Request, res: Response) => Promise<void>
  confirmOrder: (req: Request, res: Response) => Promise<void>
  cancelOrder: (req: Request, res: Response) => Promise<void>
}

export function createOrdersController(deps: { db: Pool; boss: PgBoss }): OrdersController {
  const { db, boss } = deps

  async function createOrder(req: Request, res: Response): Promise<void> {
    const idempotencyKey = req.get('idempotency-key') ?? null
    const result = await ordersService.createOrder(
      db,
      req.body as CreateOrderInput,
      req.user!.id,
      idempotencyKey,
    )
    res.status(result.replay ? 200 : 201).json({ order: result.order })
  }

  async function listOrders(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<OrdersListQuery>(ordersListQuerySchema, req.query)
    const result = await ordersService.listOrders(db, query)
    res.json({
      data: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
      },
    })
  }

  async function getOrder(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } })
      return
    }
    const order = await ordersService.getOrder(db, id)
    res.json({ order })
  }

  async function confirmOrder(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } })
      return
    }
    // R-ORD-5: Idempotency-Key drives replay (200 original) vs new confirm.
    const key = req.get('idempotency-key') ?? null
    const order = await ordersService.confirmOrder(
      db,
      id,
      key,
      { actorId: req.user!.id, actorUsername: req.user!.username },
      boss,
    )
    res.json({ order })
  }

  async function cancelOrder(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } })
      return
    }
    const order = await ordersService.cancelOrder(
      db,
      id,
      req.body as CancelOrderInput,
      { actorId: req.user!.id, actorUsername: req.user!.username },
      boss,
    )
    res.json({ order })
  }

  return { createOrder, listOrders, getOrder, confirmOrder, cancelOrder }
}