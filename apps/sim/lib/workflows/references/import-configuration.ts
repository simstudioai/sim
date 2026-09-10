import type { Principal } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getSelectorManifestEntry,
  isSelectorReady,
  type SelectorKey,
} from '@/lib/selectors/manifest'
import type { SelectorContext } from '@/lib/selectors/types'
import { collectForkCustomBlockReconfigs } from '@/lib/workflows/references/custom-block-reconfigs'
import { collectForkDependentReconfigs } from '@/lib/workflows/references/dependent-reconfigs'
import type {
  MappedImportOptions,
  WorkflowImportPlan,
} from '@/lib/workflows/references/import-plan'
import { readReferenceValue } from '@/lib/workflows/references/manifest'
import {
  parseCustomBlockInputStorageKey,
  parseNestedDependentKey,
  readTargetDraftDependentValue,
} from '@/lib/workflows/references/remap-references'
import { workflowSelectorValidator } from '@/lib/workflows/references/selector-values'
import { buildSelectorContextFromBlock } from '@/lib/workflows/subblocks/context'
import {
  type CanonicalModeOverrides,
  scopeCanonicalModesForTool,
} from '@/lib/workflows/subblocks/visibility'

export interface ImportConfigurationField {
  blockId: string
  subBlockKey: string
  title: string
  required: boolean
  configured: boolean
  selectorKey?: string
  multiSelect?: boolean
  context: Record<string, string>
  requiresAuthentication: boolean
}

/** Uses the same registered dependency graph as sync; all public identities remain source identities. */
export async function inspectImportConfiguration(
  plan: WorkflowImportPlan,
  options: MappedImportOptions,
  workspaceId: string
) {
  const identity = 'import'
  const items = [
    { sourceWorkflowId: identity, targetWorkflowId: identity, mode: 'create' as const },
  ]
  const sourceStates = new Map([[identity, plan.sourceState]])
  const resolveBlock = (_workflowId: string, blockId: string) => blockId
  const fields = [
    ...collectForkDependentReconfigs(items, sourceStates, resolveBlock, 'create', true),
    ...(await collectForkCustomBlockReconfigs({
      items,
      sourceStates,
      resolveTargetBlockId: resolveBlock,
      targetWorkspaceId: workspaceId,
      resolve: (kind, id) =>
        plan.bindings.find((binding) => binding.kind === kind && binding.sourceId === id)?.targetId,
    })),
  ]
  for (const value of options.dependentValues ?? []) {
    if (
      !fields.some(
        (field) => field.targetBlockId === value.blockId && field.subBlockKey === value.subBlockKey
      )
    ) {
      throw new OrchestrationError(
        'validation',
        `Dependent field ${value.subBlockKey} is not configurable; use a resource binding for resource selections`
      )
    }
    const conflict = plan.bindings.find(
      (binding) =>
        binding.occurrence.blockId === value.blockId &&
        binding.targetId &&
        (binding.occurrence.valuePath.length
          ? `${binding.occurrence.subBlockKey}[${binding.occurrence.valuePath[0]}].${binding.occurrence.valuePath.at(-1)}`
          : binding.occurrence.subBlockKey) === value.subBlockKey
    )
    if (conflict && conflict.targetId !== value.value)
      throw new OrchestrationError(
        'validation',
        'Dependent value conflicts with a resource binding'
      )
  }
  return fields.map((field) => {
    const block = plan.state.blocks[field.targetBlockId]
    const custom = parseCustomBlockInputStorageKey(field.subBlockKey)
    const value = custom
      ? String(block.subBlocks[custom.fieldId]?.value ?? '')
      : readTargetDraftDependentValue(block.subBlocks, block.subBlocks, field.subBlockKey)
    let context: SelectorContext = {}
    let requiresAuthentication = false
    if (field.selectorKey) {
      const nested = parseNestedDependentKey(field.subBlockKey)
      let blockType = block.type
      let subBlocks: Record<string, { value?: unknown }> = block.subBlocks
      let canonicalModes: CanonicalModeOverrides | undefined = block.data?.canonicalModes
      if (nested) {
        const tool = readReferenceValue(block.subBlocks[nested.toolInputId]?.value, [nested.index])
        if (isRecordLike(tool) && typeof tool.type === 'string') {
          blockType = tool.type
          subBlocks = Object.fromEntries(
            Object.entries({
              operation: tool.operation,
              ...(isRecordLike(tool.params) ? tool.params : {}),
            }).map(([key, value]) => [key, { value }])
          )
          canonicalModes = scopeCanonicalModesForTool(
            block.data?.canonicalModes,
            nested.index,
            blockType
          )
        }
      }
      context = buildSelectorContextFromBlock(blockType, subBlocks, {
        selectorKey: field.selectorKey as SelectorKey,
        canonicalModes,
        triggerMode: block.triggerMode,
        staticContext: field.context.mimeType ? { mimeType: field.context.mimeType } : undefined,
      })
      if (field.selectorKey === 'mcp.tools' && nested) {
        const tool = readReferenceValue(block.subBlocks[nested.toolInputId]?.value, [nested.index])
        context =
          isRecordLike(tool) &&
          isRecordLike(tool.params) &&
          typeof tool.params.serverId === 'string'
            ? { mcpServerId: tool.params.serverId }
            : {}
      }
      const manifest = getSelectorManifestEntry(field.selectorKey as SelectorKey)
      requiresAuthentication =
        manifest.context.allowed.includes('oauthCredential') && !context.oauthCredential
      for (const sensitive of manifest.context.sensitive ?? [])
        if (context[sensitive] && !/^\{\{[\s\w]+\}\}$/.test(context[sensitive]))
          requiresAuthentication = true
    }
    return {
      blockId: block.id,
      subBlockKey: field.subBlockKey,
      title: field.title,
      required: field.required,
      configured: value !== '',
      selectorKey: field.selectorKey,
      multiSelect: field.multiSelect,
      context,
      requiresAuthentication,
      value,
    }
  })
}

/** Validates submitted provider choices through the existing authorized selector operation. */
export async function validateImportSelectorValues(
  principal: Principal,
  workspaceId: string,
  fields: Awaited<ReturnType<typeof inspectImportConfiguration>>,
  options: MappedImportOptions
) {
  const validate = workflowSelectorValidator(principal, workspaceId)
  for (const field of fields) {
    const supplied = options.dependentValues?.some(
      (value) => value.blockId === field.blockId && value.subBlockKey === field.subBlockKey
    )
    if (!field.selectorKey || !field.value || (!supplied && field.selectorKey !== 'mcp.tools'))
      continue
    if (!isSelectorReady(field.selectorKey as SelectorKey, field.context)) {
      field.configured = false
      continue
    }
    if (!(await validate({ ...field, selectorKey: field.selectorKey }))) {
      if (supplied)
        throw new OrchestrationError(
          'validation',
          `${field.title} is not an available choice under its destination dependencies`
        )
      field.configured = false
    }
  }
}

/** Strips values and sensitive selector dependencies before returning configuration instructions. */
export function publicImportConfiguration(
  fields: Awaited<ReturnType<typeof inspectImportConfiguration>>
): ImportConfigurationField[] {
  return fields.map(({ value: _value, context, ...field }) => {
    const safe: Record<string, string> = {}
    const sensitive = field.selectorKey
      ? (getSelectorManifestEntry(field.selectorKey as SelectorKey).context.sensitive ?? [])
      : []
    for (const [key, value] of Object.entries(context))
      if (!sensitive.some((field) => field === key) || /^\{\{[\s\w]+\}\}$/.test(value))
        safe[key] = value
    return { ...field, context: safe }
  })
}
