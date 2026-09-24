import { useState } from 'react'
import { createWarehouse, deleteWarehouse, listWarehouses, renameWarehouse } from '../../api/warehouses.ts'
import type { Warehouse } from '../../api/types.ts'
import { useResource } from '../../hooks/useResource.ts'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { localizeError } from '../../i18n/localizeError.ts'
import { formatDateTime } from '../../i18n/formatters.ts'
import { DataTable } from '../../components/DataTable.tsx'
import type { Column } from '../../components/DataTable.tsx'
import { Modal } from '../../components/Modal.tsx'
import { ConfirmButton } from '../../components/ConfirmButton.tsx'
import { FormField, Input } from '../../components/FormField.tsx'
import { RoleGate } from '../../components/RoleGate.tsx'
import { showToast } from '../../components/ToastProvider.tsx'

/**
 * Warehouses tab inside the Stock module (it3 T-3-7 — R-UI-CRM-8, manager+).
 * List from GET /api/warehouses (it1 delta — the derived-from-stock
 * workaround was descoped at design), create form (empty name blocked
 * client-side), rename PATCH, and confirm-gated DELETE whose 409
 * WAREHOUSE_IN_USE is localized (never silent — code-auditor rule).
 */
export function WarehousesTab() {
  const { t, locale } = useTranslation()
  const { data, loading, error, refetch } = useResource(() => listWarehouses({ page: 1, limit: 100 }), [])

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)

  const columns: readonly Column<Warehouse>[] = [
    { key: 'name', header: t('crm.warehouse.name') },
    { key: 'createdAt', header: t('crm.customer.createdAt'), render: (row) => formatDateTime(row.createdAt, locale) },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (row) => (
        <div className="row-actions">
          <RoleGate permission="stock:product_manage">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(row)}>
              {t('common.edit')}
            </button>
            <ConfirmButton
              label={t('common.delete')}
              confirmLabel={t('crm.warehouse.confirmDelete')}
              onConfirm={() => handleDelete(row)}
            />
          </RoleGate>
        </div>
      ),
    },
  ]

  async function handleDelete(warehouse: Warehouse): Promise<void> {
    try {
      await deleteWarehouse(warehouse.id)
      showToast('success', t('crm.warehouse.deleted'))
      refetch()
    } catch (err) {
      // 409 WAREHOUSE_IN_USE → localized; never silent (code-auditor).
      showToast('error', localizeError(err, t))
    }
  }

  return (
    <section className="module-tab" aria-label={t('crm.warehouse.listTitle')}>
      <div className="page-toolbar">
        <h2>{t('crm.warehouse.listTitle')}</h2>
        <RoleGate permission="stock:product_manage">
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            {t('crm.warehouse.create')}
          </button>
        </RoleGate>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        keyOf={(row) => row.id}
        loading={loading}
        error={error ? localizeError(error, t) : null}
        onRetry={refetch}
      />

      {creating ? (
        <Modal title={t('crm.warehouse.create')} onClose={() => setCreating(false)}>
          <WarehouseNameForm
            onSubmit={async (name) => {
              await createWarehouse(name)
              showToast('success', t('crm.warehouse.created'))
              setCreating(false)
              refetch()
            }}
            onClose={() => setCreating(false)}
          />
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={t('crm.warehouse.edit')} onClose={() => setEditing(null)}>
          <WarehouseNameForm
            initialName={editing.name}
            onSubmit={async (name) => {
              await renameWarehouse(editing.id, name)
              showToast('success', t('crm.warehouse.updated'))
              setEditing(null)
              refetch()
            }}
            onClose={() => setEditing(null)}
          />
        </Modal>
      ) : null}
    </section>
  )
}

/** Shared name input form with client-side empty-name block (R-UI-CRM-8). */
function WarehouseNameForm({
  initialName = '',
  onSubmit,
  onClose,
}: {
  initialName?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(): Promise<void> {
    if (name.trim() === '') {
      setError(t('crm.warehouse.nameRequired'))
      return
    }
    setError(null)
    setPending(true)
    setFormError(null)
    try {
      await onSubmit(name.trim())
    } catch (err) {
      setFormError(localizeError(err, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="form-stack">
      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <FormField label={t('crm.warehouse.name')} htmlFor="warehouse-name" error={error}>
        <Input id="warehouse-name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="form-actions">
        <button type="button" className="btn" disabled={pending} onClick={() => void handleSubmit()}>
          {pending ? t('common.loading') : t('common.save')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}