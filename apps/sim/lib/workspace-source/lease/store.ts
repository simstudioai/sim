/**
 * The per-workspace lease that serializes workspace source applies: an apply's re-checks and
 * writes are separate statements and often separate transactions (a knowledge base uploads its
 * documents one by one), so only one apply may write a workspace at a time.
 *
 * A lease row (`workspace_source_apply_lease`), not a Postgres advisory lock: an apply spans many
 * transactions, so a transaction-scoped lock cannot cover it, and a session lock lives on a server
 * connection that a transaction-pooling PgBouncer hands to other clients between transactions. The
 * row is held by a random token, renewed while the apply writes, and deleted when it ends; a
 * process that dies stops renewing, and the next apply takes the lease over once it expires.
 * Every time is the database's clock, so app servers never disagree about expiry. Callers pass
 * canonical ids, never a principal: `applyWorkspaceSource` authorizes first.
 */
import { db } from '@sim/db'
import { workspaceSourceApplyLease } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, lte, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const logger = createLogger('WorkspaceSourceApplyLease')

/** How long a lease outlives its last renewal: the longest a dead apply blocks the next one. */
const LEASE_TTL_SECONDS = 120

/** How often a held lease is renewed in the background, well inside its TTL. */
const RENEW_INTERVAL_MS = 30_000

const expiry = () => sql`now() + make_interval(secs => ${LEASE_TTL_SECONDS})`

/**
 * Another apply is writing the workspace (`409`, `details.code` `SOURCE_BUSY`): nothing of this
 * apply was written. Apply again once it finished.
 */
export class WorkspaceSourceBusyError extends OrchestrationError {
  constructor() {
    super(
      'conflict',
      'Another workspace source apply is writing this workspace; nothing was written. Apply again once it finished.'
    )
    this.name = 'WorkspaceSourceBusyError'
  }
}

/**
 * This apply's lease expired and another apply took it over (this process stalled past the TTL):
 * the apply stops before its next write.
 */
class WorkspaceSourceLeaseLostError extends OrchestrationError {
  constructor() {
    super(
      'conflict',
      'This apply stalled and another apply took over the workspace; it stopped before the next write.'
    )
    this.name = 'WorkspaceSourceLeaseLostError'
  }
}

/**
 * Whether `error` is this apply losing its lease part-way: not a refusal of anything it writes,
 * so applying again (once the other apply finished) continues where it stopped.
 */
export function isApplyLeaseLost(error: unknown): boolean {
  return error instanceof WorkspaceSourceLeaseLostError
}

/** A held apply lease. */
export interface ApplyLease {
  /** Renews the lease, throwing {@link WorkspaceSourceLeaseLostError} when it is no longer held. */
  confirm(): Promise<void>
  /** Gives the lease up; never throws, and a lease it fails to delete expires on its own. */
  release(): Promise<void>
}

async function renew(workspaceId: string, token: string): Promise<boolean> {
  const rows = await db
    .update(workspaceSourceApplyLease)
    .set({ expiresAt: expiry() })
    .where(
      and(
        eq(workspaceSourceApplyLease.workspaceId, workspaceId),
        eq(workspaceSourceApplyLease.token, token)
      )
    )
    .returning({ token: workspaceSourceApplyLease.token })
  return rows.length > 0
}

/**
 * Takes the workspace's apply lease, or throws {@link WorkspaceSourceBusyError} while another
 * apply holds an unexpired one. The lease renews itself until `release`.
 */
export async function acquireApplyLease(workspaceId: string): Promise<ApplyLease> {
  const token = generateId()
  const taken = await db
    .insert(workspaceSourceApplyLease)
    .values({ workspaceId, token, expiresAt: expiry() })
    .onConflictDoUpdate({
      target: workspaceSourceApplyLease.workspaceId,
      set: { token, acquiredAt: sql`now()`, expiresAt: expiry() },
      where: lte(workspaceSourceApplyLease.expiresAt, sql`now()`),
    })
    .returning({ token: workspaceSourceApplyLease.token })
  if (taken.length === 0) throw new WorkspaceSourceBusyError()

  const timer = setInterval(() => {
    renew(workspaceId, token)
      .then((held) => {
        if (!held) logger.warn('Workspace source apply lease lost', { workspaceId })
      })
      .catch((error: unknown) => {
        logger.warn('Renewing the workspace source apply lease failed', {
          workspaceId,
          error: getErrorMessage(error),
        })
      })
  }, RENEW_INTERVAL_MS)
  timer.unref()

  return {
    async confirm() {
      if (!(await renew(workspaceId, token))) throw new WorkspaceSourceLeaseLostError()
    },
    async release() {
      clearInterval(timer)
      try {
        await db
          .delete(workspaceSourceApplyLease)
          .where(
            and(
              eq(workspaceSourceApplyLease.workspaceId, workspaceId),
              eq(workspaceSourceApplyLease.token, token)
            )
          )
      } catch (error) {
        logger.warn('Releasing the workspace source apply lease failed', {
          workspaceId,
          error: getErrorMessage(error),
        })
      }
    },
  }
}
