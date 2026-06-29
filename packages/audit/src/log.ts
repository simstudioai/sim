import { auditLog, db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { AuditActionType, AuditResourceTypeValue } from './types'

const logger = createLogger('AuditLog')

interface AuditLogParams {
  workspaceId?: string | null
  /**
   * The acting user's id (FK to `user.id`). Pass `null` for genuinely
   * actor-less events such as anonymous public-share access — the row is then
   * persisted with a null actor and the forensic context (ip/user-agent,
   * metadata) carries the trail instead.
   */
  actorId: string | null
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

  /**
   * `actorId` is a FK to `user.id`. System actors (e.g. the shared `'admin-api'`
   * key) have no user row, so we persist a null FK with a readable label instead
   * of letting the insert fail. When the caller already supplies actorName/Email
   * we trust the id is a real user and skip the lookup.
   */
  let actorId: string | null = params.actorId

  if (actorName === undefined && actorEmail === undefined && actorId) {
    try {
      const [row] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, actorId))
        .limit(1)
      if (row) {
        actorName = row.name ?? undefined
        actorEmail = row.email ?? undefined
      } else {
        actorName = actorId === 'admin-api' ? 'Admin API' : 'System'
        actorId = null
      }
    } catch (error) {
      // The lookup couldn't confirm the user exists, so null the FK to guarantee
      // the insert can't violate it (e.g. a system actor like 'admin-api', or a
      // since-deleted user). The label still identifies the actor.
      logger.warn('Failed to resolve actor info', { error, actorId })
      actorName = actorId === 'admin-api' ? 'Admin API' : 'System'
      actorId = null
    }
  }

  await db.insert(auditLog).values({
    id: generateShortId(),
    workspaceId: params.workspaceId || null,
    actorId,
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
