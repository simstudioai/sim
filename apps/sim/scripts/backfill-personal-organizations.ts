#!/usr/bin/env bun

/**
 * Gives every account outside a team its personal organization and attaches the workspaces it
 * owns without one (with their Projects), so every person belongs to an organization.
 *
 * Run it only once the app version that reads `organization.kind` is fully deployed. That
 * version bills a personal organization's workspaces to their owner exactly as before; the
 * version before it would bill them to an organization with no plan. New signups already get
 * their personal organization at signup, and opening the workspace list provisions one for
 * anyone this script has not reached yet, so the order of users does not matter.
 *
 * Every write goes through `provisionPersonalOrganization`, the helper signup uses: one short
 * transaction per user under the invitation, organization and billing-identity locks every
 * attach path takes, so it is safe while the app serves traffic. It is idempotent and resumable:
 * a user who already has their personal organization only gets newly found organization-less
 * workspaces attached; a user in a team is left alone, their organization-less workspaces
 * included. Re-running, or resuming with `--after <last cursor>`, picks up where a run stopped.
 *
 * A workspace whose Project also holds another owner's environment cannot move without it and is
 * reported as skipped; a user whose Projects were locked by a concurrent change is reported as
 * failed. Both are picked up by a later run.
 *
 * Usage:
 *   # Count the users still to provision
 *   DATABASE_URL=... bun run apps/sim/scripts/backfill-personal-organizations.ts
 *
 *   # Provision, writing a JSON report
 *   DATABASE_URL=... bun run apps/sim/scripts/backfill-personal-organizations.ts --apply \
 *     --report ./personal-organizations-report.json
 *
 * Options:
 *   --apply              Perform the writes. Omit to count candidates only.
 *   --batch-size <n>     Users read per page (default 200, max 2000).
 *   --after <userId>     Resume after this user id (the cursor a previous run printed).
 *   --report <path>      Write a JSON report of the run.
 *   --help               Print this message.
 */

import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { db } from '@sim/db'
import { member, organization, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, count, eq, exists, gt, isNull, notExists, or, type SQL } from 'drizzle-orm'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'

const logger = createLogger('BackfillPersonalOrganizations', { enabled: true, logLevel: 'INFO' })

const DEFAULT_BATCH_SIZE = 200
const MAX_BATCH_SIZE = 2000

interface BackfillReport {
  apply: boolean
  startedAt: string
  finishedAt: string | null
  candidates: number
  provisioned: number
  created: number
  attachedWorkspaces: number
  skippedWorkspaceIds: string[]
  teamMembers: number
  failures: Array<{ userId: string; error: string }>
  lastCursor: string | null
}

/**
 * Users the backfill still has work for: in no organization, or in their personal organization
 * while still owning a workspace that has none.
 */
function candidateUsersWhere(): SQL {
  const inPersonalOrganization = exists(
    db
      .select({ id: member.id })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, user.id), eq(organization.kind, 'personal')))
  )
  const ownsUnassignedWorkspace = exists(
    db
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.ownerId, user.id), isNull(workspace.organizationId)))
  )
  const inNoOrganization = notExists(
    db.select({ id: member.id }).from(member).where(eq(member.userId, user.id))
  )
  return or(inNoOrganization, and(inPersonalOrganization, ownsUnassignedWorkspace)) as SQL
}

function readOptions() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'batch-size': { type: 'string' },
      after: { type: 'string' },
      report: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })
  const batchSize = values['batch-size'] ? Number(values['batch-size']) : DEFAULT_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`)
  }
  return {
    apply: values.apply,
    batchSize,
    after: values.after ?? null,
    reportPath: values.report ?? null,
    help: values.help,
  }
}

async function main(): Promise<void> {
  const options = readOptions()
  if (options.help) {
    logger.info('See the header of scripts/backfill-personal-organizations.ts for usage')
    return
  }

  const report: BackfillReport = {
    apply: options.apply,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    candidates: 0,
    provisioned: 0,
    created: 0,
    attachedWorkspaces: 0,
    skippedWorkspaceIds: [],
    teamMembers: 0,
    failures: [],
    lastCursor: options.after,
  }

  const [{ value: candidates }] = await db
    .select({ value: count() })
    .from(user)
    .where(
      options.after ? and(gt(user.id, options.after), candidateUsersWhere()) : candidateUsersWhere()
    )
  report.candidates = candidates
  logger.info('Users to provision', { candidates, after: options.after })

  if (options.apply) {
    let cursor = options.after
    while (true) {
      const batch = await db
        .select({ id: user.id })
        .from(user)
        .where(cursor ? and(gt(user.id, cursor), candidateUsersWhere()) : candidateUsersWhere())
        .orderBy(asc(user.id))
        .limit(options.batchSize)
      if (batch.length === 0) break

      for (const { id: userId } of batch) {
        try {
          const result = await provisionPersonalOrganization(userId)
          if (result.status === 'provisioned') {
            report.provisioned += 1
            if (result.created) report.created += 1
            report.attachedWorkspaces += result.attachedWorkspaceIds.length
            report.skippedWorkspaceIds.push(...result.skippedWorkspaceIds)
          } else if (result.status === 'team-member') {
            report.teamMembers += 1
          }
        } catch (error) {
          report.failures.push({ userId, error: getErrorMessage(error) })
          logger.error('Failed to provision personal organization', {
            userId,
            error: getErrorMessage(error),
          })
        }
      }

      cursor = batch[batch.length - 1].id
      report.lastCursor = cursor
      logger.info('Provisioned batch', {
        cursor,
        provisioned: report.provisioned,
        created: report.created,
        attachedWorkspaces: report.attachedWorkspaces,
        failures: report.failures.length,
      })
    }
  }

  report.finishedAt = new Date().toISOString()
  if (options.reportPath) {
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  logger.info('Personal organization backfill finished', {
    apply: report.apply,
    candidates: report.candidates,
    provisioned: report.provisioned,
    created: report.created,
    attachedWorkspaces: report.attachedWorkspaces,
    skippedWorkspaces: report.skippedWorkspaceIds.length,
    failures: report.failures.length,
    lastCursor: report.lastCursor,
  })
  if (report.failures.length > 0) process.exitCode = 1
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    logger.error('Personal organization backfill crashed', { error: getErrorMessage(error) })
    process.exit(1)
  })
