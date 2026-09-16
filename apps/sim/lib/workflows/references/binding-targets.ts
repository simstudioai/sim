import type { Principal } from '@sim/auth/principal'
import {
  credential,
  customBlock,
  customTools,
  document,
  folder,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflow,
  workflowDeploymentVersion,
  workspace,
  workspaceEnvironment,
  workspaceFiles,
  workspaceSandbox,
} from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { credentialProviderMatchesService, getServiceConfigByServiceId } from '@/lib/oauth/utils'
import type { WorkflowImportPlan } from '@/lib/workflows/references/import-plan'
import {
  buildWorkflowReferenceManifest,
  readReferenceValue,
} from '@/lib/workflows/references/manifest'
import {
  filterExistingForkTargets,
  getCredentialProvidersByIds,
  getWorkspaceEnvKeys,
} from '@/lib/workflows/references/resources'
import type { WorkflowResourceKind } from '@/lib/workflows/references/types'
import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'
import { getBlock } from '@/blocks/registry'

/** Validates only destination resources. Source identifiers are never queried. */
export async function validateWorkflowBindingTargets(
  executor: DbOrTx,
  workspaceId: string,
  plan: WorkflowImportPlan,
  options: { lock?: boolean } = {}
) {
  const targets: Partial<Record<WorkflowResourceKind, Set<string>>> = {}
  const workflowIds = new Set<string>()
  for (const binding of plan.bindings) {
    if (!binding.targetId) continue
    if (binding.kind === 'workflow') workflowIds.add(binding.targetId)
    else (targets[binding.kind] ??= new Set()).add(binding.targetId)
  }
  const [existing, envKeys, providers, workflows, sandboxes] = await Promise.all([
    filterExistingForkTargets(executor, workspaceId, targets),
    targets['env-var']?.size
      ? getWorkspaceEnvKeys(executor, workspaceId)
      : Promise.resolve(new Set<string>()),
    getCredentialProvidersByIds(executor, workspaceId, [...(targets.credential ?? [])]),
    workflowIds.size
      ? executor
          .select({ id: workflow.id })
          .from(workflow)
          .where(
            and(
              eq(workflow.workspaceId, workspaceId),
              isNull(workflow.archivedAt),
              inArray(workflow.id, [...workflowIds])
            )
          )
      : Promise.resolve([]),
    targets.sandbox?.size
      ? executor
          .select({
            id: workspaceSandbox.id,
            language: workspaceSandbox.language,
            specHash: workspaceSandbox.specHash,
          })
          .from(workspaceSandbox)
          .where(
            and(
              eq(workspaceSandbox.workspaceId, workspaceId),
              inArray(workspaceSandbox.id, [...targets.sandbox])
            )
          )
      : Promise.resolve([]),
  ])
  for (const binding of plan.bindings) {
    if (!binding.targetId) continue
    const valid =
      binding.kind === 'workflow'
        ? workflows.some((row) => row.id === binding.targetId)
        : binding.kind === 'env-var'
          ? envKeys.has(binding.targetId)
          : existing[binding.kind]?.has(binding.targetId)
    if (!valid)
      throw new OrchestrationError(
        'validation',
        `Binding target is not an accessible ${binding.kind} in the destination workspace`
      )
    const block = plan.sourceState.blocks[binding.occurrence.blockId]
    if (binding.kind === 'sandbox') {
      const sandbox = sandboxes.find((row) => row.id === binding.targetId)
      const path = binding.occurrence.valuePath
      const language = path.length
        ? readReferenceValue(block.subBlocks[binding.occurrence.subBlockKey]?.value, [
            path[0],
            'params',
            'language',
          ])
        : block.subBlocks.language?.value
      if (language && language !== 'shell' && sandbox?.language !== language)
        throw new OrchestrationError(
          'validation',
          'Sandbox language does not match the Function block'
        )
    }
    if (binding.kind === 'credential') {
      let config = getBlock(block.type)?.subBlocks.find(
        (field) => field.id === binding.occurrence.subBlockKey
      )
      const path = binding.occurrence.valuePath
      if (path.length > 0) {
        const tool = readReferenceValue(block.subBlocks[binding.occurrence.subBlockKey]?.value, [
          path[0],
        ])
        if (isRecordLike(tool) && typeof tool.type === 'string') {
          config = getToolInputParamConfigs({
            tool: {
              type: tool.type,
              operation: typeof tool.operation === 'string' ? tool.operation : undefined,
              toolId: typeof tool.toolId === 'string' ? tool.toolId : undefined,
              params: isRecordLike(tool.params) ? tool.params : {},
            },
            toolIndex: typeof path[0] === 'number' ? path[0] : undefined,
            parentCanonicalModes: block.data?.canonicalModes,
          }).find(
            (field) =>
              field.paramId === path.at(-1) || field.config.canonicalParamId === path.at(-1)
          )?.config
        }
      }
      const provider = providers.get(binding.targetId)
      const service = config?.serviceId ? getServiceConfigByServiceId(config.serviceId) : null
      if (!provider || !service || !credentialProviderMatchesService(provider, service))
        throw new OrchestrationError(
          'validation',
          'Credential provider does not match the bound field'
        )
    }
    if (binding.kind === 'knowledge-document') {
      const kb = plan.bindings.find(
        (parent) =>
          parent.kind === 'knowledge-base' &&
          parent.occurrence.blockId === binding.occurrence.blockId &&
          parent.occurrence.subBlockKey ===
            (binding.occurrence.valuePath.length
              ? binding.occurrence.subBlockKey
              : parent.occurrence.subBlockKey) &&
          parent.occurrence.valuePath[0] === binding.occurrence.valuePath[0] &&
          parent.targetId
      )
      if (!kb)
        throw new OrchestrationError(
          'validation',
          'A document binding requires its parent knowledge base binding'
        )
      const [row] = await executor
        .select({ id: document.id })
        .from(document)
        .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
        .where(
          and(
            eq(document.id, binding.targetId),
            eq(document.knowledgeBaseId, kb.targetId!),
            eq(knowledgeBase.workspaceId, workspaceId)
          )
        )
        .limit(1)
      if (!row)
        throw new OrchestrationError(
          'validation',
          'Document does not belong to the bound knowledge base'
        )
    }
  }
  return {
    providers: [...providers].sort(),
    sandboxes: sandboxes.sort((a, b) => a.id.localeCompare(b.id)),
    resources: plan.bindings.map(({ kind, targetId }) => ({ kind, targetId })),
    revisions: await loadTargetRevisions(executor, workspaceId, plan, options.lock),
  }
}

/** Credential membership is judged against the authenticated human, never an attribution owner. */
export async function authorizeWorkflowBindingCredentials(
  principal: Principal,
  workspaceId: string,
  plan: WorkflowImportPlan
): Promise<void> {
  const ids = new Set(
    plan.bindings
      .filter((binding) => binding.kind === 'credential' && binding.targetId)
      .map((binding) => binding.targetId!)
  )
  if (!ids.size) return
  if (
    principal.kind !== 'session' &&
    principal.kind !== 'personal_api_key' &&
    principal.kind !== 'oauth_access_token'
  ) {
    throw new OrchestrationError(
      'forbidden',
      'Credential binding requires a personal API key or OAuth user'
    )
  }
  for (const credentialId of ids) {
    const access = await authorizeCredentialUseForAuth(
      { success: true, userId: principal.userId },
      { workspaceId, credentialId }
    )
    if (!access.ok || access.workspaceId !== workspaceId)
      throw new OrchestrationError(
        'forbidden',
        'Credential binding requires access to the destination connection'
      )
  }
}

/** Hashes only authorized destination rows; no secret-bearing row is returned to the caller. */
async function loadTargetRevisions(
  executor: DbOrTx,
  workspaceId: string,
  plan: WorkflowImportPlan,
  lock = false
) {
  const revisions: Array<{ kind: string; revision: string | null }> = []
  const groups = new Map<string, Set<string>>()
  for (const { kind, targetId } of plan.bindings) {
    if (!targetId) continue
    const ids = groups.get(kind) ?? new Set<string>()
    ids.add(targetId)
    groups.set(kind, ids)
  }
  const customTypes = [...(groups.get('custom-block') ?? [])]
  const customBlocks = customTypes.length
    ? await executor
        .select({ id: customBlock.id, workflowId: customBlock.workflowId })
        .from(customBlock)
        .innerJoin(workspace, eq(workspace.organizationId, customBlock.organizationId))
        .where(and(eq(workspace.id, workspaceId), inArray(customBlock.type, customTypes)))
    : []
  if (lock && customBlocks.length) {
    const backingIds = [...new Set(customBlocks.map((row) => row.workflowId))].sort()
    await executor.execute(
      sql`SELECT id FROM ${workflow} WHERE id IN (${sql.join(
        backingIds.map((id) => sql`${id}`),
        sql`, `
      )}) ORDER BY id FOR SHARE`
    )
  }
  for (const [kind, ids] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const values = sql.join(
      [...ids].map((id) => sql`${id}`),
      sql`, `
    )
    let rows: SQL
    switch (kind) {
      case 'credential':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${credential} r WHERE r.id IN (${values})`
        break
      case 'table':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${userTableDefinitions} r WHERE r.id IN (${values})`
        break
      case 'knowledge-base':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${knowledgeBase} r WHERE r.id IN (${values})`
        break
      case 'knowledge-document':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${document} r WHERE r.id IN (${values})`
        break
      case 'sandbox':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${workspaceSandbox} r WHERE r.id IN (${values})`
        break
      case 'custom-block':
        rows = sql`SELECT r.id, to_jsonb(r) || jsonb_build_object('deployment', d.state) AS state FROM ${customBlock} r LEFT JOIN ${workflowDeploymentVersion} d ON d.workflow_id = r.workflow_id AND d.is_active = true WHERE r.id IN (${
          customBlocks.length
            ? sql.join(
                customBlocks.map((row) => sql`${row.id}`),
                sql`, `
              )
            : sql`NULL`
        })`
        break
      case 'custom-tool':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${customTools} r WHERE r.id IN (${values})`
        break
      case 'mcp-server':
        rows = sql`SELECT r.id, to_jsonb(r) - ARRAY['updated_at', 'last_connected_at', 'last_tools_refresh', 'tool_count', 'connection_status', 'last_error'] AS state FROM ${mcpServers} r WHERE r.id IN (${values})`
        break
      case 'skill':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${skill} r WHERE r.id IN (${values})`
        break
      case 'file':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${workspaceFiles} r WHERE r.key IN (${values}) AND r.workspace_id = ${workspaceId}`
        break
      case 'file-folder':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${folder} r WHERE r.workspace_id = ${workspaceId}`
        break
      case 'env-var':
        rows = sql`SELECT e.key AS id, e.value AS state FROM ${workspaceEnvironment} r CROSS JOIN LATERAL jsonb_each(r.variables::jsonb) e WHERE r.workspace_id = ${workspaceId} AND e.key IN (${values})`
        break
      case 'workflow':
        rows = sql`SELECT r.id, to_jsonb(r) AS state FROM ${workflow} r WHERE r.id IN (${values})`
        break
      default:
        throw new OrchestrationError('validation', 'Unsupported binding kind')
    }
    if (lock) rows = sql`${rows} FOR SHARE OF r`
    const [row] = await executor.execute<{ revision: string | null }>(
      sql`SELECT md5(coalesce(string_agg(md5(state::text), '' ORDER BY id), '')) AS revision FROM (${rows}) revisions`
    )
    revisions.push({ kind, revision: row?.revision ?? null })
  }
  return revisions.sort((a, b) => a.kind.localeCompare(b.kind))
}

/** Rechecks protected references introduced by dependent selections against their final parents. */
export async function validateFinalWorkflowBindingTargets(
  executor: DbOrTx,
  workspaceId: string,
  plan: WorkflowImportPlan,
  options: { lock?: boolean } = {}
) {
  const manifest = buildWorkflowReferenceManifest(plan.state.blocks)
  const bindings = manifest.references
    .flatMap((reference) =>
      reference.occurrences.map((occurrence) => ({
        kind: reference.kind,
        sourceId: reference.sourceId,
        targetId: reference.sourceId,
        required: reference.required,
        occurrence,
      }))
    )
    .filter(
      (binding) =>
        !plan.unresolvedBindings.some(
          (unresolved) =>
            unresolved.kind === binding.kind && unresolved.sourceId === binding.sourceId
        )
    )
  return validateWorkflowBindingTargets(
    executor,
    workspaceId,
    { ...plan, manifest, sourceState: plan.state, bindings },
    options
  )
}
