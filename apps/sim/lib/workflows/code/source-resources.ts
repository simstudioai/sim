import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialMember,
  knowledgeBase,
  userTableDefinitions,
  workflowBlocks,
  workflow as workflowTable,
} from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import type { ResourceKind } from '@sim/workflow-code'
import { and, asc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { SourceResources } from '@/lib/api/contracts/v2/source-resources'
import { catalogDelegationPolicy } from '@/lib/catalog/application/authorization'
import {
  defineAuthorizedWorkspaceUseCase,
  type WorkspaceAuthorizationContext,
  type WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import { SHARED_CREDENTIAL_TYPES } from '@/lib/credentials/access'
import { credentialAccessClause, credentialMembershipJoin } from '@/lib/credentials/queries'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { INPUT_DEFINITION_TRIGGER_TYPES } from '@/lib/workflows/triggers/input-definition-triggers'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { type ResourceIdRef, resolveKeys } from '@/lib/workspaces/resource-keys'

/**
 * Most resources of one kind the manifest lists, oldest first. Past it the manifest says
 * `truncated`; source can still name a later resource by its key.
 */
const MAX_MANIFEST_RESOURCES_PER_KIND = 1000

/** Credential types a `credential(...)` can name: every saved account, never an env secret. */
const ENV_CREDENTIAL_TYPES = ['env_workspace', 'env_personal'] as const

type ManifestColumn = SourceResources['tables'][number]['columns'][number]
type ManifestWorkflowInputs = SourceResources['workflows'][number]['inputs']

interface ReadSourceResourcesInput {
  workspaceId: string
}

/**
 * Copilot reads the manifest with the source catalog's audience, but only for the workspace its
 * delegation is bound to: the manifest names that workspace's credentials and env variables.
 */
const sourceResourcesDelegationPolicy = {
  audience: catalogDelegationPolicy.audience,
  isWithinScope: (principal, context) => principal.workspaceId === context.workspaceId,
} as const satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>

/** One more row than the cap, so a full page tells a capped list from an exact one. */
const PAGE = MAX_MANIFEST_RESOURCES_PER_KIND + 1

function columnsOf(schema: unknown): ManifestColumn[] {
  if (!isRecordLike(schema) || !Array.isArray(schema.columns)) return []
  return schema.columns.flatMap((column): ManifestColumn[] => {
    if (!isRecordLike(column) || typeof column.name !== 'string') return []
    const type = typeof column.type === 'string' ? column.type : 'string'
    const options = Array.isArray(column.options)
      ? column.options.flatMap((option) =>
          isRecordLike(option) && typeof option.id === 'string' ? [option.id] : []
        )
      : []
    return [{ name: column.name, type, ...(options.length > 0 ? { options } : {}) }]
  })
}

/** The input fields each workflow's start block declares. */
async function loadWorkflowInputs(
  workflowIds: string[]
): Promise<Map<string, ManifestWorkflowInputs>> {
  const inputs = new Map<string, ManifestWorkflowInputs>()
  if (workflowIds.length === 0) return inputs
  const rows = await db
    .select({
      workflowId: workflowBlocks.workflowId,
      id: workflowBlocks.id,
      type: workflowBlocks.type,
      subBlocks: workflowBlocks.subBlocks,
    })
    .from(workflowBlocks)
    .where(
      and(
        inArray(workflowBlocks.workflowId, workflowIds),
        inArray(workflowBlocks.type, [...INPUT_DEFINITION_TRIGGER_TYPES])
      )
    )
    .orderBy(asc(workflowBlocks.workflowId), asc(workflowBlocks.id))
  for (const row of rows) {
    if (inputs.has(row.workflowId)) continue
    const fields = extractInputFieldsFromBlocks({
      [row.id]: { type: row.type, subBlocks: row.subBlocks },
    })
    inputs.set(
      row.workflowId,
      fields.map((field) => ({ name: field.name, type: field.type }))
    )
  }
  return inputs
}

/** Env names the caller's runs resolve: the workspace's, plus the caller's personal ones. */
async function loadEnvNames(workspaceId: string, userId: string | undefined): Promise<string[]> {
  const scope = userId
    ? or(
        and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'env_workspace')),
        and(eq(credential.type, 'env_personal'), eq(credential.envOwnerUserId, userId))
      )
    : and(eq(credential.workspaceId, workspaceId), eq(credential.type, 'env_workspace'))
  const rows = await db.select({ envKey: credential.envKey }).from(credential).where(scope)
  const names = new Set(rows.flatMap((row) => (row.envKey ? [row.envKey] : [])))
  return [...names].sort(compareStrings)
}

/**
 * The saved credentials (never env secrets) the caller may see, by the credential listing's own
 * access rule: a user sees what they are a member of, their own personal tokens and, as a
 * workspace admin, every shared credential. A caller with no human subject (a workspace API key)
 * sees the shared credentials only, never anyone's personal ones.
 */
async function loadVisibleCredentials(workspaceId: string, userId: string | undefined) {
  const columns = {
    id: credential.id,
    name: credential.displayName,
    type: credential.type,
    providerId: credential.providerId,
  }
  const scope = and(
    eq(credential.workspaceId, workspaceId),
    notInArray(credential.type, [...ENV_CREDENTIAL_TYPES])
  )
  const order = [asc(credential.createdAt), asc(credential.id)]
  if (!userId) {
    return db
      .select(columns)
      .from(credential)
      .where(and(scope, inArray(credential.type, SHARED_CREDENTIAL_TYPES)))
      .orderBy(...order)
      .limit(PAGE)
  }
  const access = await checkWorkspaceAccess(workspaceId, userId)
  return db
    .select(columns)
    .from(credential)
    .leftJoin(credentialMember, credentialMembershipJoin(userId))
    .where(and(scope, credentialAccessClause(userId, access.canAdmin)))
    .orderBy(...order)
    .limit(PAGE)
}

function capped<T>(rows: T[]): { rows: T[]; truncated: boolean } {
  return rows.length > MAX_MANIFEST_RESOURCES_PER_KIND
    ? { rows: rows.slice(0, MAX_MANIFEST_RESOURCES_PER_KIND), truncated: true }
    : { rows, truncated: false }
}

/**
 * The workspace resources a workflow file can name, by the keys source uses for them: tables
 * with their columns, knowledge bases, saved credentials with their provider, workflows with
 * the inputs their start block declares, and env variable names (never values). Credentials are
 * the ones the caller's credential listing shows. The CLI writes it
 * as `workspace.d.ts`, so `table('tickets')`, `credential('support-slack')` and `env.X` type-check.
 *
 * Every listed resource gets its key here (`resolveKeys` allocates one for a resource no source
 * has named yet), so a key an agent reads from the manifest resolves on apply. That allocation is
 * idempotent identity bookkeeping, not a change to any resource, which is why a read-role caller
 * (Copilot included) may cause it. Not audited, like the other catalog reads.
 */
export const readSourceResources = defineAuthorizedWorkspaceUseCase({
  operation: workflowOperations.readSourceResources,
  resolveContext: ({ input }: { input: ReadSourceResourcesInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: sourceResourcesDelegationPolicy },
  execute: async ({ principal, context }): Promise<SourceResources> => {
    await requireWorkflowCodeEnabled()
    const workspaceId = context.workspaceId
    const userId = resolvePrincipalSubjectUserId(principal)

    const [tableRows, kbRows, credentialRows, workflowRows, env] = await Promise.all([
      db
        .select({
          id: userTableDefinitions.id,
          name: userTableDefinitions.name,
          schema: userTableDefinitions.schema,
        })
        .from(userTableDefinitions)
        .where(
          and(
            eq(userTableDefinitions.workspaceId, workspaceId),
            isNull(userTableDefinitions.archivedAt)
          )
        )
        .orderBy(asc(userTableDefinitions.createdAt), asc(userTableDefinitions.id))
        .limit(PAGE),
      db
        .select({ id: knowledgeBase.id, name: knowledgeBase.name })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
        .orderBy(asc(knowledgeBase.createdAt), asc(knowledgeBase.id))
        .limit(PAGE),
      loadVisibleCredentials(workspaceId, userId),
      db
        .select({ id: workflowTable.id, name: workflowTable.name })
        .from(workflowTable)
        .where(and(eq(workflowTable.workspaceId, workspaceId), isNull(workflowTable.archivedAt)))
        .orderBy(asc(workflowTable.createdAt), asc(workflowTable.id))
        .limit(PAGE),
      loadEnvNames(workspaceId, userId),
    ])

    const tables = capped(tableRows)
    const kbs = capped(kbRows)
    const credentials = capped(credentialRows)
    const workflows = capped(workflowRows)

    const refs: ResourceIdRef[] = [
      ...tables.rows.map((row) => ({ kind: 'table' as const, id: row.id })),
      ...kbs.rows.map((row) => ({ kind: 'knowledge-base' as const, id: row.id })),
      ...credentials.rows.map((row) => ({ kind: 'credential' as const, id: row.id })),
      ...workflows.rows.map((row) => ({ kind: 'workflow' as const, id: row.id })),
    ]
    const [keys, inputs] = await Promise.all([
      resolveKeys(workspaceId, refs, { createdBy: userId ?? null }),
      loadWorkflowInputs(workflows.rows.map((row) => row.id)),
    ])
    const keyOf = (kind: ResourceKind, id: string) => keys.get(kind)?.get(id)

    return {
      workspaceId,
      tables: tables.rows.flatMap((row) => {
        const key = keyOf('table', row.id)
        return key ? [{ key, id: row.id, name: row.name, columns: columnsOf(row.schema) }] : []
      }),
      knowledgeBases: kbs.rows.flatMap((row) => {
        const key = keyOf('knowledge-base', row.id)
        return key ? [{ key, id: row.id, name: row.name }] : []
      }),
      credentials: credentials.rows.flatMap((row) => {
        const key = keyOf('credential', row.id)
        return key
          ? [{ key, id: row.id, name: row.name, provider: row.providerId ?? row.type }]
          : []
      }),
      workflows: workflows.rows.flatMap((row) => {
        const key = keyOf('workflow', row.id)
        return key ? [{ key, id: row.id, name: row.name, inputs: inputs.get(row.id) ?? [] }] : []
      }),
      env,
      truncated: tables.truncated || kbs.truncated || credentials.truncated || workflows.truncated,
    }
  },
})
