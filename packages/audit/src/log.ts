import { auditLog, db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { createClientIpResolver } from '@sim/security/ip'
import { generateShortId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { AuditActionType, AuditResourceTypeValue } from './types'

const logger = createLogger('AuditLog')
const clientIpResolver = createClientIpResolver(process.env.AUTH_TRUSTED_PROXIES)

export interface AuditLogParams {
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

/**
 * Fire-and-forget audit log write. Never throws; failures are logged.
 * Resolves actorName/actorEmail from the user table when both are omitted.
 */
export function recordAudit(params: AuditLogParams): void {
  insertAuditLog(params).catch((error) => {
    logger.error('Failed to record audit log', { error, action: params.action })
  })
}

/**
 * Rows per INSERT statement. Keeps each statement's bind-parameter count
 * far below Postgres's 65k limit while still writing large batches in a
 * handful of round-trips.
 */
const AUDIT_BATCH_CHUNK_SIZE = 500

/**
 * Fire-and-forget batch audit write: one INSERT per chunk instead of one
 * pooled query per entry, so callers auditing many resources at once (e.g.
 * a bulk workspace detach) do not fan out N concurrent pool checkouts.
 *
 * Unlike {@link recordAudit} there is no lazy actor resolution — entries
 * are inserted exactly as provided. Callers must pass an `actorId` that is
 * a real `user.id` or `null`, and should supply `actorName`/`actorEmail`
 * labels for system actors.
 */
export function recordAuditBatch(entries: AuditLogParams[]): void {
  insertAuditLogBatch(entries).catch((error) => {
    logger.error('Failed to record audit log batch', { error, count: entries.length })
  })
}

/**
 * Build the `audit_log` row for an entry. Shared by the single and batch
 * insert paths so the write shape cannot drift between them. Actor fields
 * are taken as-is — lazy actor resolution is layered on top by
 * {@link recordAudit} only.
 */
function buildAuditRow(
  params: AuditLogParams,
  actor: { actorId: string | null; actorName?: string | null; actorEmail?: string | null },
  id = generateShortId()
) {
  return {
    id,
    workspaceId: params.workspaceId || null,
    actorId: actor.actorId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    actorName: actor.actorName ?? undefined,
    actorEmail: actor.actorEmail ?? undefined,
    resourceName: params.resourceName,
    description: params.description,
    metadata: params.metadata ?? {},
    ipAddress: params.request ? clientIpResolver.resolve(params.request.headers) : undefined,
    userAgent: params.request?.headers.get('user-agent') ?? undefined,
  }
}

/**
 * Persists one audit row under a caller-owned idempotency key.
 *
 * External operations use this after recovering a provider result from an
 * ambiguous response loss. Awaiting the insert closes the crash gap before the
 * operation is reported as recovered, while the primary-key conflict turns a
 * retry into an authoritative no-op instead of a duplicate audit row.
 */
export async function recordAuditOnce(id: string, params: AuditLogParams): Promise<void> {
  if (!id.trim()) throw new Error('Idempotent audit ID must not be empty')

  const actor = await resolveAuditActor(params)
  await db
    .insert(auditLog)
    .values(buildAuditRow(params, actor, id))
    .onConflictDoNothing({ target: auditLog.id })
}

async function insertAuditLogBatch(entries: AuditLogParams[]): Promise<void> {
  if (entries.length === 0) return

  const rows = entries.map((params) =>
    buildAuditRow(params, {
      actorId: params.actorId,
      actorName: params.actorName,
      actorEmail: params.actorEmail,
    })
  )

  for (let index = 0; index < rows.length; index += AUDIT_BATCH_CHUNK_SIZE) {
    await db.insert(auditLog).values(rows.slice(index, index + AUDIT_BATCH_CHUNK_SIZE))
  }
}

async function insertAuditLog(params: AuditLogParams): Promise<void> {
  const actor = await resolveAuditActor(params)
  await db.insert(auditLog).values(buildAuditRow(params, actor))
}

async function resolveAuditActor(params: AuditLogParams): Promise<{
  actorId: string | null
  actorName?: string | null
  actorEmail?: string | null
}> {
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
      // Couldn't confirm the user exists — null the FK so the insert can't violate
      // it (system actor like 'admin-api', or a deleted user); the label remains.
      logger.warn('Failed to resolve actor info', { error, actorId })
      actorName = actorId === 'admin-api' ? 'Admin API' : 'System'
      actorId = null
    }
  }

  return { actorId, actorName, actorEmail }
}
