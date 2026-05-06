import { auditLog, db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { AuditActionType, AuditResourceTypeValue } from './types'

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
  request?: { headers: { get(name: string): string | null } }
}

function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

/**
 * Fire-and-forget audit log write. Never throws; failures are logged.
 * Resolves actorName/actorEmail from the user table when both are omitted.
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
