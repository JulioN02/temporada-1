import type { Request, Response } from 'express'
import type { Pool } from 'pg'
import { parseOrThrow } from '../../middleware/validate.ts'
import { auditListQuerySchema, type AuditListQuery } from './dto.ts'
import * as auditService from './service.ts'

/**
 * Audit controller (T-6-1, R-AUD-4) — orchestration only, ≤15 lines
 * (R-NFR-4). Permission enforcement lives in the route (audit:read).
 */
export interface AuditController {
  list: (req: Request, res: Response) => Promise<void>
}

export function createAuditController(deps: { db: Pool }): AuditController {
  async function list(req: Request, res: Response): Promise<void> {
    const query = parseOrThrow<AuditListQuery>(auditListQuerySchema, req.query)
    const result = await auditService.readAudit(deps.db, query)
    res.json({
      data: result.items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    })
  }

  return { list }
}