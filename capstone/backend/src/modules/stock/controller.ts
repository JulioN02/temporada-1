import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import type { PgBoss } from 'pg-boss'
import { parseOrThrow } from '../../middleware/validate.ts'
import type {
  CreateProductInput,
  CreateWarehouseInput,
  MovementCreateInput,
  MovementsListQuery,
  ProductsListQuery,
  StockQuery,
  TransferCreateInput,
  UpdateProductInput,
  UpdateWarehouseInput,
  WarehousesListQuery,
} from './dto.ts'
import { movementsListQuerySchema, productsListQuerySchema, stockQuerySchema, warehousesListQuerySchema } from './dto.ts'
import * as stockService from './service.ts'

/**
 * Stock controller (T-3-6 catalog + T-4-5 ledger) — orchestration only, every
 * endpoint ≤15 lines (R-NFR-4). Movements/transfers read the Idempotency-Key
 * header (R-STK-6): replay → 200, new → 201.
 */
export interface StockController {
  createProduct: (req: Request, res: Response) => Promise<void>
  listProducts: (req: Request, res: Response) => Promise<void>
  updateProduct: (req: Request, res: Response) => Promise<void>
  createWarehouse: (req: Request, res: Response) => Promise<void>
  listWarehouses: (req: Request, res: Response) => Promise<void>
  updateWarehouse: (req: Request, res: Response) => Promise<void>
  deleteWarehouse: (req: Request, res: Response) => Promise<void>
  createMovement: (req: Request, res: Response) => Promise<void>
  createTransfer: (req: Request, res: Response) => Promise<void>
  getStock: (req: Request, res: Response) => Promise<void>
  listMovements: (req: Request, res: Response) => Promise<void>
}

export function createStockController(deps: { db: Pool; boss: PgBoss }): StockController {
  const { db, boss } = deps

  async function createProduct(req: Request, res: Response): Promise<void> {
    const product = await stockService.createProduct(db, req.body as CreateProductInput)
    res.status(201).json({ product })
  }

  async function listProducts(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<ProductsListQuery>(productsListQuerySchema, req.query)
    const result = await stockService.listProducts(db, query)
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

  /** R-UI-CRM-7: PATCH /api/products/:id (stock:product_manage). */
  async function updateProduct(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } })
      return
    }
    const product = await stockService.updateProduct(db, id, req.body as UpdateProductInput)
    res.json({ product })
  }

  async function createWarehouse(req: Request, res: Response): Promise<void> {
    const warehouse = await stockService.createWarehouse(db, req.body as CreateWarehouseInput)
    res.status(201).json({ warehouse })
  }

  /** R-UI-CRM-8: GET /api/warehouses (stock:stock_read — pickers for adjust/transfer). */
  async function listWarehouses(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<WarehousesListQuery>(warehousesListQuerySchema, req.query)
    const result = await stockService.listWarehouses(db, { page: query.page, pageSize: query.limit })
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

  /** R-UI-CRM-8: PATCH /api/warehouses/:id — rename (stock:product_manage). */
  async function updateWarehouse(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Warehouse not found' } })
      return
    }
    const warehouse = await stockService.renameWarehouse(
      db,
      id,
      (req.body as UpdateWarehouseInput).name,
    )
    res.json({ warehouse })
  }

  /** R-UI-CRM-8: DELETE /api/warehouses/:id — 204 | 409 WAREHOUSE_IN_USE. */
  async function deleteWarehouse(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Warehouse not found' } })
      return
    }
    await stockService.deleteWarehouse(db, id)
    res.status(204).end()
  }

  async function createMovement(req: Request, res: Response): Promise<void> {
    const key = req.get('idempotency-key') ?? null
    const result = await stockService.adjust(
      db,
      req.body as MovementCreateInput,
      key,
      { actorId: req.user!.id, actorUsername: req.user!.username },
      boss,
    )
    res.status(result.replay ? 200 : 201).json({ movement: result.movement })
  }

  async function createTransfer(req: Request, res: Response): Promise<void> {
    const key = req.get('idempotency-key') ?? null
    const result = await stockService.transfer(
      db,
      req.body as TransferCreateInput,
      key,
      { actorId: req.user!.id, actorUsername: req.user!.username },
      boss,
    )
    res.status(result.replay ? 200 : 201).json({ movement: result.movement })
  }

  async function getStock(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<StockQuery>(stockQuerySchema, req.query)
    const result = await stockService.getStock(db, query)
    res.json(result)
  }

  async function listMovements(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<MovementsListQuery>(movementsListQuerySchema, req.query)
    const result = await stockService.listMovements(db, query)
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

  return {
    createProduct,
    listProducts,
    updateProduct,
    createWarehouse,
    listWarehouses,
    updateWarehouse,
    deleteWarehouse,
    createMovement,
    createTransfer,
    getStock,
    listMovements,
  }
}