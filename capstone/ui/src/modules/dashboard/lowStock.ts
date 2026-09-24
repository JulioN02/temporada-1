import type { StockRow } from '../../api/types.ts'

/**
 * Dashboard low-stock derivation (it3 T-3-1 — R-UI-DSH-2). Pure function:
 * rows where `level <= threshold` (equal counts as low). Levels are string
 * numerics from the API — compared as integers (never money/float math);
 * rows whose product threshold is unknown CANNOT be proven low and are
 * skipped (no silent assumption).
 */
export interface LowStockAlert {
  productId: string
  sku: string
  name: string
  warehouseName: string
  level: string
  threshold: number
}

export function deriveLowStock(rows: readonly StockRow[], thresholds: ReadonlyMap<string, number>): LowStockAlert[] {
  const alerts: LowStockAlert[] = []
  for (const row of rows) {
    const threshold = thresholds.get(row.product_id)
    if (threshold === undefined) continue
    if (Number(row.level) <= threshold) {
      alerts.push({
        productId: row.product_id,
        sku: row.sku,
        name: row.name,
        warehouseName: row.warehouse_name,
        level: row.level,
        threshold,
      })
    }
  }
  return alerts
}