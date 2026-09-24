import { api } from './client.ts'
import type { HealthStatus, SystemStatus } from './types.ts'

/**
 * Observability API module (it3 T-3-1 — dashboard R-UI-DSH-1).
 * GET /api/status requires an authenticated session (Bearer via client);
 * GET /api/health is public liveness (200 ok | 503 degraded).
 */
export function getStatus(): Promise<SystemStatus> {
  return api.get<SystemStatus>('/api/status')
}

export function getHealth(): Promise<HealthStatus> {
  return api.get<HealthStatus>('/api/health')
}