#!/usr/bin/env bun

/**
 * Rolls personal organizations back: returns every workspace of each personal organization (with
 * its Project) to the organization-less personal state it had before, then deletes the personal
 * organization and its owner membership, so the release before personal organizations can serve
 * every account again. The inverse of `scripts/backfill-personal-organizations.ts`; the runbook is
 * `scripts/backfill-personal-organizations.md`.
 *
 * Turn the `personal-organizations` flag off first, or the product shell provisions a new personal
 * organization for anyone this script leaves in none; `--apply` refuses while it is on.
 *
 * A personal organization holding content of its own (organization chats, memory spaces, Search,
 * go links, ...) is skipped and reported with the first table found, because deleting it would
 * delete that content; `--delete-content` deletes it with the organization instead (stored objects
 * and chat backends queued for cleanup in the same transaction). Workspace chats never moved into
 * personal organizations and are untouched.
 *
 * Each personal organization is reverted in one short transaction under the same workspace
 * invitation, organization and billing-identity locks the backfill and every attach path take,
 * after which the organization row is locked so writes in flight finish first. Detaching changes
 * no payer: a personal organization's workspaces already bill their billed account. Idempotent
 * and resumable: a reverted organization no longer exists, so a rerun, or `--after <cursor>`,
 * picks up the rest.
 *
 * Usage:
 *   # Count the personal organizations still to revert
 *   DATABASE_URL=... bun run apps/sim/scripts/revert-personal-organizations.ts
 *
 *   # Revert, writing a JSON report
 *   DATABASE_URL=... bun run apps/sim/scripts/revert-personal-organizations.ts --apply \
 *     --report ./personal-organizations-revert-report.json
 *
 * Options:
 *   --apply              Perform the writes. Omit to count candidates only.
 *   --delete-content     Also revert personal organizations holding content, deleting it.
 *   --batch-size <n>     Organizations read per page (default 200, max 2000).
 *   --after <orgId>      Resume after this organization id (the cursor a previous run printed).
 *   --report <path>      Write a JSON report of the run.
 *   --help               Print this message.
 */

import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { db } from '@sim/db'
import { member, organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, count, eq, gt, type SQL } from 'drizzle-orm'
import {
  acquireOrganizationMutationLock,
  acquireUserBillingIdentityLock,
} from '@/lib/billing/organizations/membership'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { acquireInvitationMutationLocks } from '@/lib/invitations/locks'
import { enqueuePersonalOrganizationAuditTx } from '@/lib/organizations/lifecycle-audit'
import {
  detachPersonalOrganizationWorkspacesTx,
  findCascadingOrganizationContentTx,
  releasePersonalOrganizationInvitationsTx,
} from '@/lib/organizations/personal'
import { enqueueOrganizationResourceCleanup } from '@/lib/organizations/resource-cleanup'
import { parseBatchSize } from '@/scripts/backfill-personal-organizations'

const logger = createLogger('RevertPersonalOrganizations', { enabled: true, logLevel: 'INFO' })

export type RevertPersonalOrganizationResult =
  | { status: 'reverted'; detachedWorkspaceIds: string[]; deletedContent: boolean }
  /** Holds content of its own; `table` is the first table found holding it. */
  | { status: 'holds-content'; table: string }
  | { status: 'gone' }

interface RevertReport {
  apply: boolean
  deleteContent: boolean
  startedAt: string
  finishedAt: string | null
  candidates: number
  reverted: number
  detachedWorkspaces: number
  withContentDeleted: number
  skippedWithContent: Array<{ organizationId: string; table: string }>
  failures: Array<{ organizationId: string; error: string }>
  lastCursor: string | null
}

/** Rolls the detach back when a personal organization holds content the run may not delete. */
class HoldsContent extends Error {
  constructor(readonly table: string) {
    super(`Personal organization holds ${table} rows`)
  }
}

function personalOrganizationsWhere(cursor: string | null): SQL {
  const personal = eq(organization.kind, 'personal')
  return cursor ? (and(personal, gt(organization.id, cursor)) as SQL) : personal
}

/**
 * Reverts one personal organization: detaches its workspaces, releases its invitations and
 * deletes it with its owner membership, unless it holds content and `deleteContent` is off.
 */
export async function revertPersonalOrganization(
  organizationId: string,
  { deleteContent }: { deleteContent: boolean }
): Promise<RevertPersonalOrganizationResult> {
  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.organizationId, organizationId), eq(organization.kind, 'personal')))
    .limit(1)
  if (!owner) return { status: 'gone' }
  const workspaces = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.organizationId, organizationId))
    .orderBy(asc(workspace.id))

  return db
    .transaction(async (tx) => {
      await acquireInvitationMutationLocks(tx, {
        invitationIds: [],
        workspaceIds: workspaces.map((row) => row.id),
      })
      await acquireOrganizationMutationLock(tx, organizationId)
      await acquireUserBillingIdentityLock(tx, owner.userId)
      const [locked] = await tx
        .select({ id: organization.id })
        .from(organization)
        .where(and(eq(organization.id, organizationId), eq(organization.kind, 'personal')))
        .for('update')
      if (!locked) return { status: 'gone' }

      const detachedWorkspaceIds = await detachPersonalOrganizationWorkspacesTx(tx, organizationId)
      await releasePersonalOrganizationInvitationsTx(tx, organizationId)
      const table = await findCascadingOrganizationContentTx(tx, organizationId)
      if (table && !deleteContent) {
        throw new HoldsContent(table)
      }
      if (table) await enqueueOrganizationResourceCleanup(tx, organizationId)
      await enqueuePersonalOrganizationAuditTx(tx, {
        change: 'reverted',
        organizationId,
        userId: owner.userId,
        metadata: { detachedWorkspaceIds, deletedContent: table !== null },
      })
      await tx.delete(member).where(eq(member.organizationId, organizationId))
      await tx.delete(organization).where(eq(organization.id, organizationId))
      return { status: 'reverted', detachedWorkspaceIds, deletedContent: table !== null } as const
    })
    .catch((error: unknown) => {
      if (error instanceof HoldsContent)
        return { status: 'holds-content', table: error.table } as const
      throw error
    })
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'delete-content': { type: 'boolean', default: false },
      'batch-size': { type: 'string' },
      after: { type: 'string' },
      report: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  return {
    apply: values.apply,
    deleteContent: values['delete-content'],
    batchSize: parseBatchSize(values['batch-size']),
    after: values.after ?? null,
    reportPath: values.report ?? null,
    help: values.help,
  }
}

async function main(): Promise<void> {
  const options = readOptions()
  if (options.help) {
    logger.info('See the header of scripts/revert-personal-organizations.ts for usage')
    return
  }
  if (options.apply && (await isFeatureEnabled('personal-organizations'))) {
    throw new Error('Turn the personal-organizations flag off before applying the rollback')
  }

  const report: RevertReport = {
    apply: options.apply,
    deleteContent: options.deleteContent,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    candidates: 0,
    reverted: 0,
    detachedWorkspaces: 0,
    withContentDeleted: 0,
    skippedWithContent: [],
    failures: [],
    lastCursor: options.after,
  }

  const [{ value: candidates }] = await db
    .select({ value: count() })
    .from(organization)
    .where(personalOrganizationsWhere(options.after))
  report.candidates = candidates
  logger.info('Personal organizations to revert', { candidates, after: options.after })

  if (options.apply) {
    let cursor = options.after
    while (true) {
      const batch = await db
        .select({ id: organization.id })
        .from(organization)
        .where(personalOrganizationsWhere(cursor))
        .orderBy(asc(organization.id))
        .limit(options.batchSize)
      if (batch.length === 0) break

      for (const { id: organizationId } of batch) {
        try {
          const result = await revertPersonalOrganization(organizationId, {
            deleteContent: options.deleteContent,
          })
          if (result.status === 'reverted') {
            report.reverted += 1
            report.detachedWorkspaces += result.detachedWorkspaceIds.length
            if (result.deletedContent) report.withContentDeleted += 1
          } else if (result.status === 'holds-content') {
            report.skippedWithContent.push({ organizationId, table: result.table })
          }
        } catch (error) {
          report.failures.push({ organizationId, error: getErrorMessage(error) })
          logger.error('Failed to revert personal organization', {
            organizationId,
            error: getErrorMessage(error),
          })
        }
      }

      cursor = batch[batch.length - 1].id
      report.lastCursor = cursor
      logger.info('Reverted batch', {
        cursor,
        reverted: report.reverted,
        detachedWorkspaces: report.detachedWorkspaces,
        skippedWithContent: report.skippedWithContent.length,
        failures: report.failures.length,
      })
    }
  }

  report.finishedAt = new Date().toISOString()
  if (options.reportPath) {
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  logger.info('Personal organization rollback finished', {
    apply: report.apply,
    candidates: report.candidates,
    reverted: report.reverted,
    detachedWorkspaces: report.detachedWorkspaces,
    withContentDeleted: report.withContentDeleted,
    skippedWithContent: report.skippedWithContent.length,
    failures: report.failures.length,
    lastCursor: report.lastCursor,
  })
  if (report.failures.length > 0) process.exitCode = 1
}

if (import.meta.main) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      logger.error('Personal organization rollback crashed', { error: getErrorMessage(error) })
      process.exit(1)
    })
}
