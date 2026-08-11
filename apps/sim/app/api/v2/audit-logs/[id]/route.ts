import { v2GetAuditLogContract } from '@/lib/api/contracts/v2/audit-logs'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { getAuditLog } from '@/lib/audit-logs/application/get-audit-log'
import { auditLogOperations } from '@/lib/audit-logs/application/operations'
import { formatV2AuditLogEntry } from '@/app/api/v2/audit-logs/format'

export const revalidate = 0

/**
 * GET /api/v2/audit-logs/[id]
 *
 * Returns a single audit log entry scoped to an explicitly selected
 * organization. Audit logs are personal-key-only because a workspace-scoped
 * key must never expand into organization-wide visibility.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetAuditLogContract,
  auth: v2ApiKeyAuth,
  operation: auditLogOperations.readDetail,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ id: params.id, organizationId: query.organizationId }),
  useCase: getAuditLog,
  present: ({ log }) => ({ data: formatV2AuditLogEntry(log) }),
})
