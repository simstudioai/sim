#!/usr/bin/env bun

/**
 * Deploys every workflow referenced by a table workflow group.
 *
 * The script is idempotent and resumable: it pages over only workflows that do
 * not have the full desired state, and each deployment uses a stable idempotency
 * key. It runs the canonical deployment orchestration so webhook, schedule,
 * MCP, audit, and notification side effects stay consistent with a
 * user-initiated deployment.
 *
 * Usage:
 *   DATABASE_URL=... bun run apps/sim/scripts/backfill-table-workflow-deployments.ts
 */

import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import {
  type PerformFullDeployResult,
  performFullDeploy,
} from '@/lib/workflows/orchestration/deploy'

const logger = createLogger('BackfillTableWorkflowDeployments')

export const TABLE_WORKFLOW_DEPLOYMENT_BATCH_SIZE = 25
const BACKFILL_ACTOR_ID = 'table-workflow-deployment-backfill'
const BACKFILL_OPERATION_VERSION = 'v2'

export interface TableWorkflowDeploymentCandidate {
  workflowId: string
  workspaceId: string
  userId: string
}

export interface TableWorkflowDeploymentStore {
  assertIntegrity(): Promise<void>
  listCandidates(
    afterWorkflowId: string,
    limit: number
  ): Promise<TableWorkflowDeploymentCandidate[]>
  isDeployed(workflowId: string): Promise<boolean>
}

export interface TableWorkflowDeploymentSummary {
  scanned: number
  deployed: number
  alreadyDeployed: number
}

interface TableWorkflowDeploymentBackfillOptions {
  batchSize?: number
}

export type DeployTableWorkflow = (
  candidate: TableWorkflowDeploymentCandidate
) => Promise<PerformFullDeployResult>

interface InvalidTableSchemaRow extends Record<string, unknown> {
  table_id: string
}

interface InvalidWorkflowGroupRow extends Record<string, unknown> {
  group_index: string
  table_id: string
}

interface InvalidWorkflowReferenceRow extends Record<string, unknown> {
  table_id: string
  table_workspace_id: string
  workflow_id: string
  workflow_workspace_id: string | null
}

interface MultipleActiveVersionsRow extends Record<string, unknown> {
  active_version_count: number
  workflow_id: string
}

interface CandidateRow extends Record<string, unknown> {
  user_id: string
  workflow_id: string
  workspace_id: string
}

interface DeploymentStateRow extends Record<string, unknown> {
  active_version_count: number
  is_deployed: boolean
}

/** Ensures the table group references can be traversed without silently dropping corrupt data. */
async function assertTableWorkflowIntegrity(): Promise<void> {
  const [invalidSchema] = await db.execute<InvalidTableSchemaRow>(sql`
    SELECT id AS table_id
    FROM user_table_definitions
    WHERE schema ? 'workflowGroups'
      AND jsonb_typeof(schema->'workflowGroups') IS DISTINCT FROM 'array'
    LIMIT 1
  `)
  if (invalidSchema) {
    throw new Error(
      `Table ${invalidSchema.table_id} has a workflowGroups value that is not an array`
    )
  }

  const [invalidGroup] = await db.execute<InvalidWorkflowGroupRow>(sql`
    SELECT
      table_definition.id AS table_id,
      workflow_group.ordinality::text AS group_index
    FROM user_table_definitions AS table_definition
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(table_definition.schema->'workflowGroups', '[]'::jsonb)
    ) WITH ORDINALITY AS workflow_group(value, ordinality)
    WHERE jsonb_typeof(workflow_group.value) IS DISTINCT FROM 'object'
      OR NOT (workflow_group.value ? 'workflowId')
      OR jsonb_typeof(workflow_group.value->'workflowId') IS DISTINCT FROM 'string'
      OR (
        workflow_group.value->>'workflowId' = ''
        AND (
          NOT (workflow_group.value ? 'enrichmentId')
          OR jsonb_typeof(workflow_group.value->'enrichmentId') IS DISTINCT FROM 'string'
          OR workflow_group.value->>'enrichmentId' = ''
        )
      )
    LIMIT 1
  `)
  if (invalidGroup) {
    throw new Error(
      `Table ${invalidGroup.table_id} workflow group ${invalidGroup.group_index} has an invalid workflowId`
    )
  }

  const [invalidReference] = await db.execute<InvalidWorkflowReferenceRow>(sql`
    WITH table_workflow_groups AS (
      SELECT
        table_definition.id AS table_id,
        table_definition.workspace_id AS table_workspace_id,
        workflow_group.value->>'workflowId' AS workflow_id
      FROM user_table_definitions AS table_definition
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(table_definition.schema->'workflowGroups', '[]'::jsonb)
      ) AS workflow_group(value)
    )
    SELECT
      table_workflow_groups.table_id,
      table_workflow_groups.table_workspace_id,
      table_workflow_groups.workflow_id,
      workflow.workspace_id AS workflow_workspace_id
    FROM table_workflow_groups
    LEFT JOIN workflow ON workflow.id = table_workflow_groups.workflow_id
    WHERE table_workflow_groups.workflow_id <> ''
      AND (
        workflow.id IS NULL
        OR (
          workflow.archived_at IS NULL
          AND workflow.workspace_id IS DISTINCT FROM table_workflow_groups.table_workspace_id
        )
      )
    LIMIT 1
  `)
  if (invalidReference) {
    const workflowScope = invalidReference.workflow_workspace_id ?? 'missing'
    throw new Error(
      `Table ${invalidReference.table_id} in workspace ${invalidReference.table_workspace_id} ` +
        `references workflow ${invalidReference.workflow_id} in workspace ${workflowScope}`
    )
  }

  const [multipleActiveVersions] = await db.execute<MultipleActiveVersionsRow>(sql`
    WITH referenced_workflow_ids AS (
      SELECT DISTINCT workflow_group.value->>'workflowId' AS workflow_id
      FROM user_table_definitions AS table_definition
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(table_definition.schema->'workflowGroups', '[]'::jsonb)
      ) AS workflow_group(value)
      INNER JOIN workflow ON workflow.id = workflow_group.value->>'workflowId'
        AND workflow.archived_at IS NULL
      WHERE workflow_group.value->>'workflowId' <> ''
    )
    SELECT
      deployment_version.workflow_id,
      COUNT(*)::int AS active_version_count
    FROM workflow_deployment_version AS deployment_version
    INNER JOIN referenced_workflow_ids
      ON referenced_workflow_ids.workflow_id = deployment_version.workflow_id
    WHERE deployment_version.is_active = true
    GROUP BY deployment_version.workflow_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `)
  if (multipleActiveVersions) {
    throw new Error(
      `Workflow ${multipleActiveVersions.workflow_id} has ${multipleActiveVersions.active_version_count} active deployment versions`
    )
  }
}

export const postgresTableWorkflowDeploymentStore: TableWorkflowDeploymentStore = {
  assertIntegrity: assertTableWorkflowIntegrity,

  async listCandidates(afterWorkflowId, limit) {
    const rows = await db.execute<CandidateRow>(sql`
      WITH referenced_workflow_ids AS (
        SELECT DISTINCT workflow_group.value->>'workflowId' AS workflow_id
        FROM user_table_definitions AS table_definition
        CROSS JOIN LATERAL jsonb_array_elements(
          COALESCE(table_definition.schema->'workflowGroups', '[]'::jsonb)
        ) AS workflow_group(value)
        WHERE workflow_group.value->>'workflowId' <> ''
      )
      SELECT
        workflow.id AS workflow_id,
        workflow.workspace_id AS workspace_id,
        workflow.user_id
      FROM referenced_workflow_ids
      INNER JOIN workflow ON workflow.id = referenced_workflow_ids.workflow_id
        AND workflow.archived_at IS NULL
      WHERE workflow.id COLLATE "C" > ${afterWorkflowId}::text COLLATE "C"
        AND (
          workflow.is_deployed = false
          OR NOT EXISTS (
            SELECT 1
            FROM workflow_deployment_version AS active_version
            WHERE active_version.workflow_id = workflow.id
              AND active_version.is_active = true
          )
        )
      ORDER BY workflow.id COLLATE "C"
      LIMIT ${limit}
    `)

    return rows.map((row) => ({
      workflowId: row.workflow_id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
    }))
  },

  async isDeployed(workflowId) {
    const [state] = await db.execute<DeploymentStateRow>(sql`
      SELECT
        workflow.is_deployed,
        (COUNT(deployment_version.id) FILTER (WHERE deployment_version.is_active))::int
          AS active_version_count
      FROM workflow
      LEFT JOIN workflow_deployment_version AS deployment_version
        ON deployment_version.workflow_id = workflow.id
      WHERE workflow.id = ${workflowId}
      GROUP BY workflow.id, workflow.is_deployed
    `)
    if (!state) {
      throw new Error(`Workflow ${workflowId} disappeared during the deployment backfill`)
    }
    if (state.active_version_count > 1) {
      throw new Error(
        `Workflow ${workflowId} has ${state.active_version_count} active deployment versions`
      )
    }
    return state.is_deployed && state.active_version_count === 1
  },
}

/** Deploys one table workflow through the same orchestration used by application surfaces. */
export async function deployTableWorkflow(
  candidate: TableWorkflowDeploymentCandidate
): Promise<PerformFullDeployResult> {
  return performFullDeploy({
    workflowId: candidate.workflowId,
    userId: candidate.userId,
    actorId: BACKFILL_ACTOR_ID,
    captureAnalytics: false,
    requestId: `${BACKFILL_ACTOR_ID}:${BACKFILL_OPERATION_VERSION}:${candidate.workflowId}`,
    idempotencyKey: `${BACKFILL_ACTOR_ID}:${BACKFILL_OPERATION_VERSION}:${candidate.workflowId}`,
  })
}

/**
 * Reaches and verifies that every table workflow has an active deployment.
 */
export async function backfillTableWorkflowDeployments(
  store: TableWorkflowDeploymentStore,
  deploy: DeployTableWorkflow,
  options: TableWorkflowDeploymentBackfillOptions = {}
): Promise<TableWorkflowDeploymentSummary> {
  const batchSize = options.batchSize ?? TABLE_WORKFLOW_DEPLOYMENT_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('Table workflow deployment backfill batch size must be a positive integer')
  }

  await store.assertIntegrity()

  const summary: TableWorkflowDeploymentSummary = {
    scanned: 0,
    deployed: 0,
    alreadyDeployed: 0,
  }
  let afterWorkflowId = ''

  for (;;) {
    const candidates = await store.listCandidates(afterWorkflowId, batchSize)
    if (candidates.length === 0) break
    if (candidates.length > batchSize) {
      throw new Error('Table workflow deployment store returned an oversized page')
    }

    const pageIds = new Set(candidates.map((candidate) => candidate.workflowId))
    if (pageIds.size !== candidates.length) {
      throw new Error('Table workflow deployment store returned duplicate workflow ids')
    }
    const lastWorkflowId = candidates.at(-1)?.workflowId
    if (!lastWorkflowId || lastWorkflowId === afterWorkflowId) {
      throw new Error('Table workflow deployment store returned a non-advancing page')
    }

    for (const candidate of candidates) {
      summary.scanned += 1
      if (await store.isDeployed(candidate.workflowId)) {
        summary.alreadyDeployed += 1
      } else {
        logger.info('Deploying workflow referenced by a table workflow group', {
          workflowId: candidate.workflowId,
          workspaceId: candidate.workspaceId,
        })
        const result = await deploy(candidate)
        if (!result.success) {
          throw new Error(
            `Failed to deploy table workflow ${candidate.workflowId}: ${result.error ?? 'deployment returned no error'}`
          )
        }
        if (!result.activeDeployment) {
          throw new Error(
            `Table workflow ${candidate.workflowId} did not reach an active deployment state`
          )
        }
        if (!(await store.isDeployed(candidate.workflowId))) {
          throw new Error(
            `Table workflow ${candidate.workflowId} deployment completed without a valid active version`
          )
        }
        summary.deployed += 1
      }
    }

    afterWorkflowId = lastWorkflowId
  }

  await store.assertIntegrity()
  const remaining = await store.listCandidates('', 1)
  if (remaining.length > 0) {
    throw new Error(
      `Table workflow deployment backfill left workflow ${remaining[0].workflowId} undeployed`
    )
  }

  return summary
}

export async function runTableWorkflowDeploymentBackfill(): Promise<void> {
  logger.info('Starting table workflow deployment backfill')
  const summary = await backfillTableWorkflowDeployments(
    postgresTableWorkflowDeploymentStore,
    deployTableWorkflow
  )
  logger.info('Table workflow deployment backfill completed', summary)
}

if ((import.meta as { main?: boolean }).main) {
  runTableWorkflowDeploymentBackfill()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error('Table workflow deployment backfill failed', {
        error: getErrorMessage(error),
      })
      process.exit(1)
    })
}
