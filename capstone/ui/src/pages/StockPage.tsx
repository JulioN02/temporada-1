import { useState } from 'react'
import { getStock, listMovements } from '../api/stock.ts'
import { listProducts } from '../api/products.ts'
import { listWarehouses } from '../api/warehouses.ts'
import type { MovementType } from '../api/types.ts'
import { useResource } from '../hooks/useResource.ts'
import { usePagination } from '../hooks/usePagination.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import { localizeError } from '../i18n/localizeError.ts'
import { formatDateTime } from '../i18n/formatters.ts'
import { DataTable } from '../components/DataTable.tsx'
import type { Column } from '../components/DataTable.tsx'
import { Pagination } from '../components/Pagination.tsx'
import { Modal } from '../components/Modal.tsx'
import { Badge } from '../components/Badge.tsx'
import { Select } from '../components/FormField.tsx'
import { RoleGate } from '../components/RoleGate.tsx'
import { AdjustForm } from '../modules/stock/AdjustForm.tsx'
import { TransferForm } from '../modules/stock/TransferForm.tsx'
import { WarehousesTab } from '../modules/stock/WarehousesTab.tsx'
import { isLowStock, MOVEMENT_TYPE_KEYS } from '../modules/stock/forms.ts'
import type { StockRow } from '../api/types.ts'

/**
 * Stock page (it4 T-4-1..T-4-4 + it3 T-3-7) — tabs: levels, movements,
 * warehouses. Levels are STRING numerics rendered as-is (R-UI-STK-1); the
 * low badge derives from the product threshold (level <= threshold, equal
 * counts). Adjust/transfer mutations refresh levels + movements after
 * success; 409 conflicts keep cells unchanged (server all-or-nothing).
 */
const LEVELS_TAB = { levels: 'levels', movements: 'movements', warehouses: 'warehouses' } as const
type StockTab = (typeof LEVELS_TAB)[keyof typeof LEVELS_TAB]

export function StockPage() {
  const { t, locale } = useTranslation()
  const [tab, setTab] = useState<StockTab>(LEVELS_TAB.levels)

  // shared option lists (pickers + filters + thresholds)
  const productsRes = useResource(() => listProducts({ limit: 100 }), [])
  const warehousesRes = useResource(() => listWarehouses({ page: 1, limit: 100 }), [])
  const products = productsRes.data?.data ?? []
  const warehouses = warehousesRes.data?.data ?? []

  // levels
  const [levelProductId, setLevelProductId] = useState<string | undefined>(undefined)
  const [levelWarehouseId, setLevelWarehouseId] = useState<string | undefined>(undefined)
  const levelsRes = useResource(
    () => getStock({ productId: levelProductId, warehouseId: levelWarehouseId }),
    [levelProductId, levelWarehouseId],
  )

  // movements
  const [moveProductId, setMoveProductId] = useState<string | undefined>(undefined)
  const [moveType, setMoveType] = useState<MovementType | undefined>(undefined)
  const { page, limit, setPage, reset: resetPage } = usePagination({ limit: 10 })
  const movementsRes = useResource(
    () => listMovements({ productId: moveProductId, type: moveType, page, limit }),
    [moveProductId, moveType, page, limit],
  )

  const [adjusting, setAdjusting] = useState(false)
  const [transferring, setTransferring] = useState(false)

  function afterMutation(): void {
    levelsRes.refetch()
    movementsRes.refetch()
  }

  const thresholds = new Map(products.map((p) => [p.id, p.lowStockThreshold] as const))

  const levelColumns: readonly Column<StockRow>[] = [
    { key: 'name', header: t('stock.product') },
    { key: 'sku', header: t('crm.product.sku') },
    { key: 'warehouse_name', header: t('stock.warehouse') },
    {
      key: 'level',
      header: t('stock.levels.level'),
      render: (row) => {
        const threshold = thresholds.get(row.product_id)
        const low = threshold !== undefined && isLowStock(row.level, threshold)
        return (
          <span className="level-cell">
            {row.level}
            {low ? (
              <Badge tone="warning">{t('stock.levels.low')}</Badge>
            ) : null}
          </span>
        )
      },
    },
  ]

  const movementColumns: readonly Column<NonNullable<typeof movementsRes.data>['data'][number]>[] = [
    { key: 'createdAt', header: t('stock.movements.date'), render: (row) => formatDateTime(row.createdAt, locale) },
    { key: 'type', header: t('stock.movements.type'), render: (row) => t(MOVEMENT_TYPE_KEYS[row.type]) },
    { key: 'productName', header: t('stock.product') },
    { key: 'warehouseName', header: t('stock.warehouse') },
    { key: 'quantity', header: t('stock.adjust.quantity'), render: (row) => String(row.quantity) },
    { key: 'sign', header: t('stock.movements.sign'), render: (row) => (row.sign >= 0 ? '+' : '−') },
    { key: 'reason', header: t('stock.adjust.reason') },
  ]

  return (
    <div className="page">
      <h1>{t('nav.stock')}</h1>
      <div className="tabs" role="tablist" aria-label={t('nav.stock')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === LEVELS_TAB.levels}
          className={tab === LEVELS_TAB.levels ? 'tab tab-active' : 'tab'}
          onClick={() => setTab(LEVELS_TAB.levels)}
        >
          {t('stock.levels.title')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === LEVELS_TAB.movements}
          className={tab === LEVELS_TAB.movements ? 'tab tab-active' : 'tab'}
          onClick={() => setTab(LEVELS_TAB.movements)}
        >
          {t('stock.movements.title')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === LEVELS_TAB.warehouses}
          className={tab === LEVELS_TAB.warehouses ? 'tab tab-active' : 'tab'}
          onClick={() => setTab(LEVELS_TAB.warehouses)}
        >
          {t('crm.warehouse.listTitle')}
        </button>
      </div>

      {tab === LEVELS_TAB.levels ? (
        <section className="module-tab" aria-label={t('stock.levels.title')}>
          <h2>{t('stock.levels.title')}</h2>
          <div className="filters">
            <Select
              aria-label={t('stock.levels.filterProduct')}
              value={levelProductId ?? ''}
              onChange={(e) => setLevelProductId(e.target.value === '' ? undefined : e.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('stock.levels.filterWarehouse')}
              value={levelWarehouseId ?? ''}
              onChange={(e) => setLevelWarehouseId(e.target.value === '' ? undefined : e.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <RoleGate permission="stock:stock_adjust">
              <button type="button" className="btn" onClick={() => setAdjusting(true)}>
                {t('stock.adjust.title')}
              </button>
            </RoleGate>
            <RoleGate permission="stock:stock_transfer">
              <button type="button" className="btn" onClick={() => setTransferring(true)}>
                {t('stock.transfer.title')}
              </button>
            </RoleGate>
          </div>

          <DataTable
            columns={levelColumns}
            rows={levelsRes.data?.items ?? []}
            keyOf={(row) => `${row.product_id}:${row.warehouse_id}`}
            loading={levelsRes.loading}
            error={levelsRes.error ? localizeError(levelsRes.error, t) : null}
            onRetry={levelsRes.refetch}
          />
        </section>
      ) : null}

      {tab === LEVELS_TAB.movements ? (
        <section className="module-tab" aria-label={t('stock.movements.title')}>
          <h2>{t('stock.movements.title')}</h2>
          <div className="filters">
            <Select
              aria-label={t('stock.levels.filterProduct')}
              value={moveProductId ?? ''}
              onChange={(e) => {
                setMoveProductId(e.target.value === '' ? undefined : e.target.value)
                resetPage()
              }}
            >
              <option value="">{t('common.all')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('stock.movements.filterType')}
              value={moveType ?? ''}
              onChange={(e) => {
                setMoveType(e.target.value === '' ? undefined : (e.target.value as MovementType))
                resetPage()
              }}
            >
              <option value="">{t('common.all')}</option>
              {Object.entries(MOVEMENT_TYPE_KEYS).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </Select>
          </div>

          <DataTable
            columns={movementColumns}
            rows={movementsRes.data?.data ?? []}
            keyOf={(row) => row.id}
            loading={movementsRes.loading}
            error={movementsRes.error ? localizeError(movementsRes.error, t) : null}
            onRetry={movementsRes.refetch}
          />
          {movementsRes.data && movementsRes.data.pagination.totalPages > 1 ? (
            <Pagination page={page} totalPages={movementsRes.data.pagination.totalPages} onPageChange={setPage} />
          ) : null}
        </section>
      ) : null}

      {tab === LEVELS_TAB.warehouses ? <WarehousesTab /> : null}

      {adjusting ? (
        <Modal title={t('stock.adjust.title')} onClose={() => setAdjusting(false)}>
          <AdjustForm
            products={products}
            warehouses={warehouses}
            onDone={() => {
              setAdjusting(false)
              afterMutation()
            }}
          />
        </Modal>
      ) : null}

      {transferring ? (
        <Modal title={t('stock.transfer.title')} onClose={() => setTransferring(false)}>
          <TransferForm
            products={products}
            warehouses={warehouses}
            onDone={() => {
              setTransferring(false)
              afterMutation()
            }}
          />
        </Modal>
      ) : null}
    </div>
  )
}