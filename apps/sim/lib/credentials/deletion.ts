import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { CREDENTIAL_SUBBLOCK_IDS } from '@/lib/workflows/persistence/utils'

const logger = createLogger('CredentialDeletion')

export type CredentialDeleteReason =
  | 'oauth_disconnect'
  | 'user_delete'
  | 'copilot_delete'
  | 'env_prune'

interface DeleteCredentialParams {
  credentialId: string
  actorId: string
  actorName?: string | null
  actorEmail?: string | null
  reason: CredentialDeleteReason
  request?: NextRequest
}

/**
 * Clears all stored references to the credential, deletes the row, and
 * records an audit entry. Idempotent when the row no longer exists.
 */
export async function deleteCredential(params: DeleteCredentialParams): Promise<void> {
  const { credentialId, actorId, actorName, actorEmail, reason, request } = params

  const [row] = await db
    .select({
      id: schema.credential.id,
      workspaceId: schema.credential.workspaceId,
      type: schema.credential.type,
      displayName: schema.credential.displayName,
      providerId: schema.credential.providerId,
      accountId: schema.credential.accountId,
    })
    .from(schema.credential)
    .where(eq(schema.credential.id, credentialId))
    .limit(1)

  if (!row) return

  await clearCredentialRefs(credentialId, row.workspaceId)

  await db.delete(schema.credential).where(eq(schema.credential.id, credentialId))

  recordAudit({
    workspaceId: row.workspaceId,
    actorId,
    actorName: actorName ?? undefined,
    actorEmail: actorEmail ?? undefined,
    action: AuditAction.CREDENTIAL_DELETED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: credentialId,
    resourceName: row.displayName,
    description: `Deleted ${row.type} credential "${row.displayName}" (${reason})`,
    metadata: {
      reason,
      credentialType: row.type,
      providerId: row.providerId,
      accountId: row.accountId,
    },
    request,
  })

  logger.info('Deleted credential', { credentialId, workspaceId: row.workspaceId, reason })
}

/**
 * Clears stored references to a credential across mutable workspace state
 * (editor blocks, copilot checkpoints, knowledge connectors) and frozen
 * snapshots (deployed versions, paused executions). Frozen snapshots have
 * the reference replaced with an empty string so resumed/redeployed runs
 * fail fast at the affected block instead of with "credential not found".
 */
export async function clearCredentialRefs(
  credentialId: string,
  workspaceId: string
): Promise<void> {
  const needle = `%${credentialId}%`

  await Promise.all([
    clearInWorkflowBlocks(credentialId, workspaceId, needle),
    clearInDeploymentVersions(credentialId, workspaceId, needle),
    clearInPausedExecutions(credentialId, workspaceId, needle),
    clearInWorkflowCheckpoints(credentialId, workspaceId, needle),
    clearInKnowledgeConnectors(credentialId),
  ])
}

async function clearInWorkflowBlocks(
  credentialId: string,
  workspaceId: string,
  needle: string
): Promise<void> {
  const rows = await db
    .select({
      id: schema.workflowBlocks.id,
      subBlocks: schema.workflowBlocks.subBlocks,
    })
    .from(schema.workflowBlocks)
    .innerJoin(schema.workflow, eq(schema.workflow.id, schema.workflowBlocks.workflowId))
    .where(
      and(
        eq(schema.workflow.workspaceId, workspaceId),
        sql`${schema.workflowBlocks.subBlocks}::text LIKE ${needle}`
      )
    )

  let updated = 0
  for (const row of rows) {
    const next = clearCredentialInValue(row.subBlocks, credentialId)
    if (next.changed) {
      await db
        .update(schema.workflowBlocks)
        .set({ subBlocks: next.value, updatedAt: new Date() })
        .where(eq(schema.workflowBlocks.id, row.id))
      updated += 1
    }
  }
  if (updated > 0) {
    logger.info('Cleared credential refs in workflow_blocks', {
      credentialId,
      workspaceId,
      updated,
    })
  }
}

async function clearInDeploymentVersions(
  credentialId: string,
  workspaceId: string,
  needle: string
): Promise<void> {
  const rows = await db
    .select({
      id: schema.workflowDeploymentVersion.id,
      state: schema.workflowDeploymentVersion.state,
    })
    .from(schema.workflowDeploymentVersion)
    .innerJoin(schema.workflow, eq(schema.workflow.id, schema.workflowDeploymentVersion.workflowId))
    .where(
      and(
        eq(schema.workflow.workspaceId, workspaceId),
        sql`${schema.workflowDeploymentVersion.state}::text LIKE ${needle}`
      )
    )

  for (const row of rows) {
    const next = clearCredentialInValue(row.state, credentialId)
    if (next.changed) {
      await db
        .update(schema.workflowDeploymentVersion)
        .set({ state: next.value })
        .where(eq(schema.workflowDeploymentVersion.id, row.id))
    }
  }
}

async function clearInPausedExecutions(
  credentialId: string,
  workspaceId: string,
  needle: string
): Promise<void> {
  const rows = await db
    .select({
      id: schema.pausedExecutions.id,
      executionSnapshot: schema.pausedExecutions.executionSnapshot,
    })
    .from(schema.pausedExecutions)
    .innerJoin(schema.workflow, eq(schema.workflow.id, schema.pausedExecutions.workflowId))
    .where(
      and(
        eq(schema.workflow.workspaceId, workspaceId),
        sql`${schema.pausedExecutions.executionSnapshot}::text LIKE ${needle}`
      )
    )

  for (const row of rows) {
    const next = clearCredentialInValue(row.executionSnapshot, credentialId)
    if (next.changed) {
      await db
        .update(schema.pausedExecutions)
        .set({ executionSnapshot: next.value, updatedAt: new Date() })
        .where(eq(schema.pausedExecutions.id, row.id))
    }
  }
}

async function clearInWorkflowCheckpoints(
  credentialId: string,
  workspaceId: string,
  needle: string
): Promise<void> {
  const rows = await db
    .select({
      id: schema.workflowCheckpoints.id,
      workflowState: schema.workflowCheckpoints.workflowState,
    })
    .from(schema.workflowCheckpoints)
    .innerJoin(schema.workflow, eq(schema.workflow.id, schema.workflowCheckpoints.workflowId))
    .where(
      and(
        eq(schema.workflow.workspaceId, workspaceId),
        sql`${schema.workflowCheckpoints.workflowState}::text LIKE ${needle}`
      )
    )

  for (const row of rows) {
    const next = clearCredentialInValue(row.workflowState, credentialId)
    if (next.changed) {
      await db
        .update(schema.workflowCheckpoints)
        .set({ workflowState: next.value, updatedAt: new Date() })
        .where(eq(schema.workflowCheckpoints.id, row.id))
    }
  }
}

async function clearInKnowledgeConnectors(credentialId: string): Promise<void> {
  await db
    .update(schema.knowledgeConnector)
    .set({ credentialId: null, updatedAt: new Date() })
    .where(eq(schema.knowledgeConnector.credentialId, credentialId))
}

interface ClearResult {
  value: unknown
  changed: boolean
}

/**
 * Recursively walks a JSON value and clears credential references matching
 * `credentialId`. Recognizes the two reference shapes used in workflow state:
 * subBlock entries (`{id: 'credential'|'manualCredential'|'triggerCredentials', value}`)
 * and tool params (`{credential: <id>, ...}` inside a tool's `params` object).
 * Returns the original reference when nothing matched so callers can skip writes.
 */
export function clearCredentialInValue(input: unknown, credentialId: string): ClearResult {
  if (Array.isArray(input)) {
    let changed = false
    const next = input.map((item) => {
      const result = clearCredentialInValue(item, credentialId)
      if (result.changed) changed = true
      return result.value
    })
    return changed ? { value: next, changed: true } : { value: input, changed: false }
  }

  if (input !== null && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id : null
    const isCredentialSubBlock = id !== null && CREDENTIAL_SUBBLOCK_IDS.has(id)
    let changed = false
    const next: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (isCredentialSubBlock && key === 'value' && value === credentialId) {
        next[key] = ''
        changed = true
        continue
      }
      if (key === 'credential' && value === credentialId) {
        next[key] = ''
        changed = true
        continue
      }
      const result = clearCredentialInValue(value, credentialId)
      next[key] = result.value
      if (result.changed) changed = true
    }

    return changed ? { value: next, changed: true } : { value: input, changed: false }
  }

  return { value: input, changed: false }
}
