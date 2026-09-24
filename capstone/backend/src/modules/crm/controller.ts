import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import { parseOrThrow } from '../../middleware/validate.ts'
import type { CreateCustomerInput, CustomersListQuery, UpdateCustomerInput } from './dto.ts'
import { customersListQuerySchema } from './dto.ts'
import * as crmService from './service.ts'
import type { AuditMeta } from './service.ts'

/**
 * CRM controller (T-2-4) — orchestration only, every endpoint ≤15 lines
 * (R-NFR-4). Reads actor identity from the verified token for audit rows.
 */
export interface CrmController {
  createCustomer: (req: Request, res: Response) => Promise<void>
  listCustomers: (req: Request, res: Response) => Promise<void>
  getCustomer: (req: Request, res: Response) => Promise<void>
  updateCustomer: (req: Request, res: Response) => Promise<void>
}

export function createCrmController(deps: { db: Pool }): CrmController {
  const { db } = deps

  function meta(req: Request): AuditMeta {
    return { actorId: req.user?.id ?? null, actorUsername: req.user?.username ?? null }
  }

  async function createCustomer(req: Request, res: Response): Promise<void> {
    const customer = await crmService.createCustomer(db, req.body as CreateCustomerInput, meta(req))
    res.status(201).json({ customer })
  }

  async function listCustomers(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<CustomersListQuery>(customersListQuerySchema, req.query)
    const result = await crmService.listCustomers(db, query)
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

  async function getCustomer(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } })
      return
    }
    const customer = await crmService.getCustomer(db, id)
    res.json({ customer })
  }

  async function updateCustomer(req: Request, res: Response): Promise<void> {
    const id = req.params['id']
    if (typeof id !== 'string') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } })
      return
    }
    const customer = await crmService.updateCustomer(db, id, req.body as UpdateCustomerInput, meta(req))
    res.json({ customer })
  }

  return { createCustomer, listCustomers, getCustomer, updateCustomer }
}