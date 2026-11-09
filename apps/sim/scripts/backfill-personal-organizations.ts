#!/usr/bin/env bun

/**
 * Gives every account outside a team its personal organization and attaches the workspaces it
 * owns without one (with their Projects), so every person belongs to an organization.
 *
 * Deploy order (see scripts/backfill-personal-organizations.md): migrations 0455 to 0458, then the
 * app, background workers and Trigger.dev tasks on the release that reads `organization.kind`,
 * all fully rolled out; only then run this script (`--apply` refuses while the
 * `pause-personal-organizations` flag is on; `scripts/revert-personal-organizations.ts` undoes it).
 * That release bills a personal organization's workspaces to their owner exactly as before; the
 * previous one would bill them to an organization with no plan. New signups get their personal
 * organization at signup, and the
 * product shell provisions one for anyone in no organization who opens a product page before this
 * script reaches them. Both create the organization and its owner membership only; neither attaches
 * an existing workspace, so this script is the only path that moves existing workspaces (and their
 * payer bookkeeping) into personal organizations. The order of users does not matter.
 *
 * On an instance-organization deployment (`INSTANCE_ORG_NAME`), users outside every organization
 * join the instance organization instead, as signup does there.
 *
 * Every write goes through `provisionPersonalOrganization`, which only this script calls: one
 * short transaction per user under the invitation, organization and billing-identity locks every
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
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import {
  isInstanceOrganizationMode,
  joinInstanceOrganization,
} from '@/lib/organizations/instance-org'
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
  /** Users reached after the `pause-personal-organizations` flag turned on mid-run, left untouched. */
  paused: number
  failures: Array<{ userId: string; error: string }>
  lastCursor: string | null
}

/**
 * Users the backfill still has work for: in no organization, or in their personal organization
 * while still owning a workspace that has none. On an instance-organization deployment, only users
 * in no organization.
 */
function candidateUsersWhere(cursor: string | null, instanceMode: boolean): SQL {
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
  const candidate = instanceMode
    ? inNoOrganization
    : (or(inNoOrganization, and(inPersonalOrganization, ownsUnassignedWorkspace)) as SQL)
  return cursor ? (and(gt(user.id, cursor), candidate) as SQL) : candidate
}

/** The next page of candidate user ids after `cursor`, in id order. */
export async function selectCandidateBatch(
  cursor: string | null,
  size: number,
  instanceMode: boolean
): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(candidateUsersWhere(cursor, instanceMode))
    .orderBy(asc(user.id))
    .limit(size)
  return rows.map((row) => row.id)
}

/** `--batch-size`, defaulting to {@link DEFAULT_BATCH_SIZE} and bounded by {@link MAX_BATCH_SIZE}. */
export function parseBatchSize(value: string | undefined): number {
  const batchSize = value ? Number(value) : DEFAULT_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`)
  }
  return batchSize
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
  return {
    apply: values.apply,
    batchSize: parseBatchSize(values['batch-size']),
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
  const instanceMode = isInstanceOrganizationMode()
  if (options.apply && !instanceMode && (await isFeatureEnabled('pause-personal-organizations'))) {
    throw new Error('Turn the pause-personal-organizations flag off before applying the backfill')
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
    paused: 0,
    failures: [],
    lastCursor: options.after,
  }

  const [{ value: candidates }] = await db
    .select({ value: count() })
    .from(user)
    .where(candidateUsersWhere(options.after, instanceMode))
  report.candidates = candidates
  logger.info('Users to provision', { candidates, after: options.after })

  if (options.apply) {
    let cursor = options.after
    while (true) {
      const batch = await selectCandidateBatch(cursor, options.batchSize, instanceMode)
      if (batch.length === 0) break

      for (const userId of batch) {
        try {
          if (instanceMode) {
            if (!(await joinInstanceOrganization(userId))) {
              throw new Error('The instance organization did not admit this user')
            }
            report.provisioned += 1
            continue
          }
          const result = await provisionPersonalOrganization(userId)
          if (result.status === 'provisioned') {
            report.provisioned += 1
            if (result.created) report.created += 1
            report.attachedWorkspaces += result.attachedWorkspaceIds.length
            report.skippedWorkspaceIds.push(...result.skippedWorkspaceIds)
          } else if (result.status === 'team-member') {
            report.teamMembers += 1
          } else if (result.status === 'paused') {
            report.paused += 1
          }
        } catch (error) {
          report.failures.push({ userId, error: getErrorMessage(error) })
          logger.error('Failed to provision personal organization', {
            userId,
            error: getErrorMessage(error),
          })
        }
      }

      cursor = batch[batch.length - 1]
      report.lastCursor = cursor
      logger.info('Provisioned batch', {
        cursor,
        provisioned: report.provisioned,
        created: report.created,
        attachedWorkspaces: report.attachedWorkspaces,
        paused: report.paused,
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
    paused: report.paused,
    failures: report.failures.length,
    lastCursor: report.lastCursor,
  })
  if (report.failures.length > 0) process.exitCode = 1
}

if (import.meta.main) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
      logger.error('Personal organization backfill crashed', { error: getErrorMessage(error) })
      process.exit(1)
    })
}
