import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute.tsx'
import { PermissionRoute } from './components/PermissionRoute.tsx'
import { Layout } from './components/Layout.tsx'
import { LoadingState } from './components/LoadingState.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { CustomersPage } from './pages/CustomersPage.tsx'
import { ProductsPage } from './pages/ProductsPage.tsx'
import { StockPage } from './pages/StockPage.tsx'
import { OrdersPage } from './pages/OrdersPage.tsx'
import { OrderDetailPage } from './pages/OrderDetailPage.tsx'
import { NotificationsPage } from './pages/NotificationsPage.tsx'

/**
 * Governance pages are route-level LAZY chunks (R-UI-NFR-5): the login →
 * dashboard critical path never downloads audit/users/jobs. The route map
 * (design ADR-1): /login public; protected modules under the Layout; the
 * three governance routes are additionally PermissionRoute-guarded
 * (redirect /dashboard + denial toast, no API call — R-RBAC-1).
 */
const AuditPage = lazy(() => import('./pages/AuditPage.tsx').then((module) => ({ default: module.AuditPage })))
const UsersPage = lazy(() => import('./pages/UsersPage.tsx').then((module) => ({ default: module.UsersPage })))
const JobsPage = lazy(() => import('./pages/JobsPage.tsx').then((module) => ({ default: module.JobsPage })))

function withSuspense(element: ReactNode): ReactNode {
  return <Suspense fallback={<LoadingState />}>{element}</Suspense>
}

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'stock', element: <StockPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      {
        path: 'audit',
        element: withSuspense(
          <PermissionRoute permission="audit:read">
            <AuditPage />
          </PermissionRoute>,
        ),
      },
      {
        path: 'users',
        element: withSuspense(
          <PermissionRoute permission="auth:user_read">
            <UsersPage />
          </PermissionRoute>,
        ),
      },
      {
        path: 'jobs',
        element: withSuspense(
          <PermissionRoute permission="jobs:job_read">
            <JobsPage />
          </PermissionRoute>,
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes)
}