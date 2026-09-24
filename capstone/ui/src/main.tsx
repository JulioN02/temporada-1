import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { createAppRouter } from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import { LocaleBackendSync } from './components/LocaleBackendSync.tsx'
import { ToastProvider } from './components/ToastProvider.tsx'
import { LocaleProvider } from './i18n/LocaleContext.tsx'
import './styles/index.css'

/**
 * Provider order matters: LocaleProvider (toggle state) → ToastProvider →
 * AuthProvider (session) → LocaleBackendSync (backend-wins-on-boot locale
 * sync, R-I18N-3) → RouterProvider (the route tree consumes all contexts).
 */
const router = createAppRouter()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <LocaleBackendSync />
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>
  </StrictMode>,
)