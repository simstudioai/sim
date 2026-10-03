import type { ScimConnectionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { scimRequestLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { sql } from 'drizzle-orm'
import { SCIM_REQUEST_LOG_RETENTION } from '@/ee/scim/lib/protocol/constants'
import type { ScimType } from '@/ee/scim/lib/protocol/errors'

const logger = createLogger('ScimRequestLog')

/** One protocol request as the activity log records it. */
export interface ScimRequestLogEntry {
  principal: ScimConnectionPrincipal
  method: string
  path: string
  status: number
  scimType?: ScimType
  detail?: string
  userAgent: string | null
  durationMs: number
}

/**
 * Records one provisioning request for the settings activity view.
 *
 * An administrator debugging a connection has nothing else to look at:
 * Microsoft Entra reports a failed cycle without saying what it sent, and Okta
 * surfaces only the status. Fire-and-forget, because a logging failure must not
 * turn a successful provisioning call into an error the directory will retry.
 */
export function recordScimRequest(entry: ScimRequestLogEntry): void {
  void db
    .insert(scimRequestLog)
    .values({
      id: generateId(),
      connectionId: entry.principal.connectionId,
      credentialId: entry.principal.credentialId,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      scimType: entry.scimType ?? null,
      /** Bounded: a detail is a sentence for a person, not a payload dump. */
      detail: entry.detail ? truncate(entry.detail, 500) : null,
      userAgent: entry.userAgent ? truncate(entry.userAgent, 200) : null,
      durationMs: entry.durationMs,
      createdAt: new Date(),
    })
    .catch((error) => logger.warn('Failed to record a SCIM request', { error }))
}

/**
 * Trims a connection's log to its most recent rows.
 *
 * Run by the reconcile job rather than on write: pruning inline would add a
 * delete to every provisioning call, and the bound only has to hold over hours.
 */
export async function pruneScimRequestLog(connectionId: string): Promise<void> {
  await db.execute(sql`
    delete from ${scimRequestLog}
    where ${scimRequestLog.connectionId} = ${connectionId}
      and ${scimRequestLog.id} not in (
        select id from ${scimRequestLog}
        where ${scimRequestLog.connectionId} = ${connectionId}
        order by ${scimRequestLog.createdAt} desc
        limit ${SCIM_REQUEST_LOG_RETENTION}
      )
  `)
}
