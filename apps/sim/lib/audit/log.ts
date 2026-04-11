import { auditLog, db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { AuditActionType, AuditResourceTypeValue } from '@/lib/audit/types'
import { getClientIp } from '@/lib/core/utils/request'
import { generateShortId } from '@/lib/core/utils/uuid'

export type { AuditActionType, AuditResourceTypeValue } from '@/lib/audit/types'
export { AuditAction, AuditResourceType } from '@/lib/audit/types'

const logger = createLogger('AuditLog')

interface AuditLogParams {
  workspaceId?: string | null
  actorId: string
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  actorName?: string | null
  actorEmail?: string | null
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
  request?: Request
}

/**
 * Records an audit log entry. Fire-and-forget — never throws or blocks the caller.
 * If actorName and actorEmail are both undefined (not provided by the caller),
 * resolves them from the user table before inserting.
 */
export function recordAudit(params: AuditLogParams): void {
  insertAuditLog(params).catch((error) => {
    logger.error('Failed to record audit log', { error, action: params.action })
  })
}

async function insertAuditLog(params: AuditLogParams): Promise<void> {
  const ipAddress = params.request ? getClientIp(params.request) : undefined
  const userAgent = params.request?.headers.get('user-agent') ?? undefined

  let { actorName, actorEmail } = params

  if (actorName === undefined && actorEmail === undefined && params.actorId) {
    try {
      const [row] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, params.actorId))
        .limit(1)
      actorName = row?.name ?? undefined
      actorEmail = row?.email ?? undefined
    } catch (error) {
      logger.warn('Failed to resolve actor info', { error, actorId: params.actorId })
    }
  }

  await db.insert(auditLog).values({
    id: generateShortId(),
    workspaceId: params.workspaceId || null,
    actorId: params.actorId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    actorName: actorName ?? undefined,
    actorEmail: actorEmail ?? undefined,
    resourceName: params.resourceName,
    description: params.description,
    metadata: params.metadata ?? {},
    ipAddress,
    userAgent,
  })
}
