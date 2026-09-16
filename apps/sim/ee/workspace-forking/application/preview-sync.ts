import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import { collectForkCustomBlockReconfigs } from '@/lib/workflows/references/custom-block-reconfigs'
import { collectForkDependentReconfigs } from '@/lib/workflows/references/dependent-reconfigs'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import { assertWorkflowPreviewFits } from '@/lib/workflows/references/preview-limits'
import { workflowSelectorValidator } from '@/lib/workflows/references/selector-values'
import { loadForkPreviewRevision } from '@/ee/workspace-forking/application/revision'
import { validateForkWorkflowBindings } from '@/ee/workspace-forking/application/validate-bindings'
import {
  loadSourceDeployedStates,
  loadTargetWebhookPathsByBlock,
} from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { loadForkBlockMap } from '@/ee/workspace-forking/lib/mapping/block-map-store'
import { loadForkDependentValues } from '@/ee/workspace-forking/lib/mapping/dependent-value-store'
import {
  overlayForkMappingEntries,
  validateForkMappingTargets,
} from '@/ee/workspace-forking/lib/mapping/mapping-service'
import { getEdgeMappingRows } from '@/ee/workspace-forking/lib/mapping/mapping-store'
import {
  collectForkSyncBlockers,
  verifyForkDropAcknowledgments,
} from '@/ee/workspace-forking/lib/promote/cleared-refs'
import { buildPromoteCopySelection } from '@/ee/workspace-forking/lib/promote/copy-unmapped'
import type { PromoteForkParams } from '@/ee/workspace-forking/lib/promote/promote'
import { computeForkPromotePlan } from '@/ee/workspace-forking/lib/promote/promote-plan'
import {
  buildForkTriggerPlan,
  resolveForkTriggerPaths,
} from '@/ee/workspace-forking/lib/promote/trigger-urls'
import { buildForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'

const RESOURCE_CONTEXT_KINDS = {
  oauthCredential: 'credential',
  knowledgeBaseId: 'knowledge-base',
  tableId: 'table',
  mcpServerId: 'mcp-server',
} as const

export type SyncChoices = Pick<
  PromoteForkParams,
  'copyResources' | 'dropReferences' | 'triggerMappings' | 'mappings' | 'sourceDependentValues'
>
export type PreviewSyncParams = Pick<
  PromoteForkParams,
  'edge' | 'sourceWorkspaceId' | 'targetWorkspaceId' | 'direction'
> &
  SyncChoices

/** Builds a read-only plan using the same mapping, copy, reference, and trigger rules as apply. */
export async function previewForkSync(
  params: PreviewSyncParams,
  choices: Record<string, unknown>,
  principal: Principal
) {
  const { edge, sourceWorkspaceId, targetWorkspaceId } = params
  const revision = await loadForkPreviewRevision(db, params, choices)
  await validateForkMappingTargets(sourceWorkspaceId, targetWorkspaceId, params.mappings ?? [])
  const { deployedWorkflows, sourceStates } = await loadSourceDeployedStates(sourceWorkspaceId)
  const mappingRows = overlayForkMappingEntries(
    await getEdgeMappingRows(db, edge.childWorkspaceId),
    edge,
    sourceWorkspaceId,
    params.mappings ?? []
  )
  const plan = await computeForkPromotePlan({
    ...params,
    executor: db,
    deployedSourceWorkflows: deployedWorkflows,
    sourceStates,
    mappingRows,
  })
  await validateForkWorkflowBindings({
    executor: db,
    workspaceId: targetWorkspaceId,
    sourceStates,
    items: plan.items,
    resolve: plan.resolver,
    principal,
  })
  const resolveBlockId = buildForkBlockIdResolver(
    sourceWorkspaceId === edge.parentWorkspaceId,
    await loadForkBlockMap(db, edge.childWorkspaceId)
  )
  const { willResolve } = buildPromoteCopySelection(params.copyResources, plan.copyableUnmapped)
  const verifiedDrops = await verifyForkDropAcknowledgments(
    db,
    sourceWorkspaceId,
    params.dropReferences
  )
  const { blockers } = await collectForkSyncBlockers({
    executor: db,
    sourceWorkspaceId,
    items: plan.items,
    sourceStates,
    resolver: (kind, id) => (willResolve.has(`${kind}:${id}`) ? id : plan.resolver(kind, id)),
    workflowIdMap: plan.workflowIdMap,
    resolveBlockId,
    planUnmapped: [...plan.unmappedRequired, ...plan.unmappedOptional],
    droppedReferences: verifiedDrops,
  })
  const sourceItems = plan.items.map((item) => ({
    ...item,
    targetWorkflowId: item.sourceWorkflowId,
  }))
  const fields = [
    ...collectForkDependentReconfigs(sourceItems, sourceStates, (_workflowId, blockId) => blockId),
    ...collectForkDependentReconfigs(
      sourceItems,
      sourceStates,
      (_workflowId, blockId) => blockId,
      'create'
    ),
    ...(await collectForkCustomBlockReconfigs({
      items: sourceItems,
      sourceStates,
      resolveTargetBlockId: (_workflowId, blockId) => blockId,
      resolve: plan.resolver,
      targetWorkspaceId,
    })),
  ]
  const stored = await loadForkDependentValues(
    db,
    edge.childWorkspaceId,
    plan.items.map((item) => item.targetWorkflowId)
  )
  assertWorkflowPreviewFits({ configuration: fields })
  const sourceAnchors = new Map<string, Set<string>>()
  for (const item of plan.items) {
    const state = sourceStates.get(item.sourceWorkflowId)
    if (!state) continue
    for (const reference of buildWorkflowReferenceManifest(state.blocks).references) {
      if (!Object.values(RESOURCE_CONTEXT_KINDS).some((kind) => kind === reference.kind)) continue
      for (const occurrence of reference.occurrences) {
        const scope =
          typeof occurrence.valuePath[0] === 'number'
            ? `${occurrence.subBlockKey}[${occurrence.valuePath[0]}]`
            : undefined
        const key = JSON.stringify([item.sourceWorkflowId, occurrence.blockId, scope])
        const anchors = sourceAnchors.get(key) ?? new Set<string>()
        anchors.add(`${reference.kind}:${reference.sourceId}`)
        sourceAnchors.set(key, anchors)
      }
    }
  }
  const provided = params.sourceDependentValues ?? []
  const seen = new Set<string>()
  for (const value of provided) {
    const key = JSON.stringify([value.sourceWorkflowId, value.sourceBlockId, value.subBlockKey])
    if (seen.has(key))
      throw new OrchestrationError('validation', 'Duplicate dependent field instruction')
    seen.add(key)
    if (
      !fields.some(
        (field) =>
          field.targetWorkflowId === value.sourceWorkflowId &&
          field.targetBlockId === value.sourceBlockId &&
          field.subBlockKey === value.subBlockKey
      )
    )
      throw new OrchestrationError(
        'validation',
        'Dependent override does not address a configurable source field'
      )
  }
  const resolvedValues = new Map(
    fields.map((field) => {
      const item = plan.items.find((item) => item.sourceWorkflowId === field.targetWorkflowId)!
      const targetBlockId = resolveBlockId(item.targetWorkflowId, field.targetBlockId)
      const supplied = provided.find(
        (value) =>
          value.sourceWorkflowId === field.targetWorkflowId &&
          value.sourceBlockId === field.targetBlockId &&
          value.subBlockKey === field.subBlockKey
      )
      const saved =
        params.sourceDependentValues === undefined
          ? stored.find(
              (value) =>
                value.targetWorkflowId === item.targetWorkflowId &&
                value.targetBlockId === targetBlockId &&
                value.subBlockKey === field.subBlockKey
            )?.value
          : undefined
      return [
        JSON.stringify([field.targetWorkflowId, field.targetBlockId, field.subBlockKey]),
        supplied?.value ?? saved ?? '',
      ] as const
    })
  )
  const configuration = fields.map((field) => {
    const context = { ...field.context }
    if (field.parentContextKey) context[field.parentContextKey] = field.parentSourceId
    const manifest = field.selectorKey
      ? getSelectorManifestEntry(field.selectorKey as SelectorKey)
      : undefined
    if (manifest)
      for (const key of Object.keys(context))
        if (!manifest.context.allowed.some((allowed) => allowed === key)) delete context[key]
    const anchors = sourceAnchors.get(
      JSON.stringify([field.targetWorkflowId, field.targetBlockId, field.dependencyScope])
    )
    const resources = Object.entries(RESOURCE_CONTEXT_KINDS).flatMap(([key, kind]) => {
      const id = context[key]
      return id &&
        (anchors?.has(`${kind}:${id}`) ||
          (key === field.parentContextKey && kind === field.parentKind))
        ? [{ key, kind, id, copied: willResolve.has(`${kind}:${id}`) }]
        : []
    })
    const discoverSource = resources.some((resource) => resource.copied)
    if (discoverSource && resources.some((resource) => !resource.copied))
      throw new OrchestrationError(
        'validation',
        `Map the parent resources of ${field.title} before configuring dependencies from different workspaces`
      )
    for (const resource of resources)
      context[resource.key] = discoverSource
        ? resource.id
        : (plan.resolver(resource.kind, resource.id) ?? '')
    for (const sibling of fields) {
      if (
        sibling.targetWorkflowId !== field.targetWorkflowId ||
        sibling.targetBlockId !== field.targetBlockId ||
        sibling.dependencyScope !== field.dependencyScope ||
        !sibling.providesContextKey ||
        (manifest &&
          !manifest.context.allowed.some((allowed) => allowed === sibling.providesContextKey))
      )
        continue
      context[sibling.providesContextKey] =
        resolvedValues.get(
          JSON.stringify([sibling.targetWorkflowId, sibling.targetBlockId, sibling.subBlockKey])
        ) ?? ''
    }
    return {
      sourceWorkflowId: field.targetWorkflowId,
      sourceBlockId: field.targetBlockId,
      subBlockKey: field.subBlockKey,
      title: field.title,
      required: field.required,
      currentValue:
        resolvedValues.get(
          JSON.stringify([field.targetWorkflowId, field.targetBlockId, field.subBlockKey])
        ) ?? '',
      selectorKey: field.selectorKey,
      multiSelect: field.multiSelect,
      discoveryWorkspaceId: discoverSource ? sourceWorkspaceId : targetWorkspaceId,
      context,
      parentKind: field.parentKind,
      parentSourceId: field.parentSourceId,
      parentContextKey: field.parentContextKey,
    }
  })
  const validators = new Map([
    [sourceWorkspaceId, workflowSelectorValidator(principal, sourceWorkspaceId)],
    [targetWorkspaceId, workflowSelectorValidator(principal, targetWorkspaceId)],
  ])
  for (const field of configuration) {
    if (!field.selectorKey || !field.currentValue) continue
    if (
      !(await validators.get(field.discoveryWorkspaceId)!({
        ...field,
        selectorKey: field.selectorKey,
        value: field.currentValue,
      }))
    )
      throw new OrchestrationError(
        'validation',
        `${field.title} is not available under its destination dependencies`
      )
  }
  for (const field of configuration)
    if (field.selectorKey) {
      for (const sensitive of getSelectorManifestEntry(field.selectorKey as SelectorKey).context
        .sensitive ?? [])
        delete field.context[sensitive]
    }
  const triggerPlan = buildForkTriggerPlan({
    items: plan.items,
    sourceStates,
    resolveBlockId,
    targetWebhooks: await loadTargetWebhookPathsByBlock(
      db,
      plan.items.map((item) => item.targetWorkflowId)
    ),
  })
  const triggerResolution = resolveForkTriggerPaths(triggerPlan, params.triggerMappings)
  const after = await loadForkPreviewRevision(db, params, choices)
  if (after.fingerprint !== revision.fingerprint)
    throw new OrchestrationError(
      'conflict',
      'Workspace changed during preview; request another preview'
    )
  const preview = {
    previewFingerprint: revision.fingerprint,
    sourceWorkspaceId,
    targetWorkspaceId,
    ready: blockers.length === 0,
    workflows: [
      ...plan.items.map((item) => ({
        action: item.mode,
        sourceWorkflowId: item.sourceWorkflowId,
        ...(item.mode === 'replace' ? { targetWorkflowId: item.targetWorkflowId } : {}),
        name: item.sourceMeta.name,
      })),
      ...plan.archivedTargets.map((item) => ({
        action: 'archive' as const,
        targetWorkflowId: item.id,
        name: item.name,
      })),
    ],
    unresolvedBindings: blockers.map((blocker) => ({
      kind: blocker.kind,
      sourceId: blocker.sourceId,
      blockName: blocker.blockLabel,
      reason: blocker.reason,
    })),
    configuration,
    excludedTargets: plan.excludedTargets,
    triggerSlots: triggerPlan.slots.map(({ targetBlockId: _targetBlockId, ...slot }) => slot),
    triggerUrlChanges: triggerResolution.changes,
  }
  assertWorkflowPreviewFits(preview)
  return preview
}
