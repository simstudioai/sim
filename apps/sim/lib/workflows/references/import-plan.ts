import { isRecordLike, omit } from '@sim/utils/object'
import { workflowReferenceManifestSchema } from '@/lib/api/contracts/workflow-references'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { normalizeMcpBlockValues } from '@/lib/mcp/workflow-config'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import {
  coerceObjectArray,
  remapWorkflowReferencesInSubBlocks,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import {
  applyDependentOverrides,
  clearDependentsOnRemap,
  remapForkBlockType,
  remapSubBlocks,
  replaceCustomBlockInputs,
} from '@/lib/workflows/references/remap-references'
import type {
  PortableReference,
  PortableResourceKind,
  ReferenceOccurrence,
  WorkflowReferenceManifest,
} from '@/lib/workflows/references/types'
import { normalizeImportedVariables } from '@/lib/workflows/variables/parse'
import { getBlock } from '@/blocks/registry'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

export interface ImportResourceMapping {
  kind: PortableResourceKind
  sourceId: string
  targetId: string | null
}
export interface ImportFieldBinding extends ReferenceOccurrence {
  kind: PortableResourceKind
  targetId: string | null
}
export interface ImportDependentValue {
  blockId: string
  subBlockKey: string
  value: string
}
export interface MappedImportOptions {
  mappings?: ImportResourceMapping[]
  bindings?: ImportFieldBinding[]
  dependentValues?: ImportDependentValue[]
}
export interface ImportBindingResolution {
  kind: PortableResourceKind
  sourceId: string
  targetId: string | null
  required: boolean
  occurrence: ReferenceOccurrence
}
export interface WorkflowImportPlan {
  sourceState: WorkflowState
  state: WorkflowState
  manifest: WorkflowReferenceManifest
  bindings: ImportBindingResolution[]
  unresolvedBindings: ImportBindingResolution[]
}

export function referenceOccurrenceKey(
  occurrence: Pick<ReferenceOccurrence, 'blockId' | 'subBlockKey' | 'valuePath'>
): string {
  return JSON.stringify([occurrence.blockId, occurrence.subBlockKey, occurrence.valuePath])
}

function encodeIdentifiers(ids: string[], encoding: ReferenceOccurrence['encoding']): unknown {
  if (encoding === 'files') return ids.map((key) => ({ key }))
  if (encoding === 'array') return ids
  if (encoding === 'csv') return ids.join(',')
  if (ids.length > 1)
    throw new OrchestrationError('validation', 'A scalar binding cannot contain multiple resources')
  return ids[0] ?? ''
}

/** Writes only registered locators into a clone; no caller-controlled object merge occurs. */
function writeOccurrence(
  blocks: Record<string, BlockState>,
  occurrence: ReferenceOccurrence,
  value: unknown
): void {
  const block = Object.hasOwn(blocks, occurrence.blockId) ? blocks[occurrence.blockId] : undefined
  if (!block) throw new OrchestrationError('validation', 'Reference block does not exist')
  if (occurrence.subBlockKey === 'type' && occurrence.valuePath.length === 0) {
    if (typeof value !== 'string')
      throw new OrchestrationError('validation', 'Invalid custom block binding')
    block.type = value
    return
  }
  const field = Object.hasOwn(block.subBlocks, occurrence.subBlockKey)
    ? block.subBlocks[occurrence.subBlockKey]
    : undefined
  if (!field) throw new OrchestrationError('validation', 'Reference field does not exist')
  if (occurrence.valuePath.length === 0) {
    field.value = value as BlockState['subBlocks'][string]['value']
    return
  }
  const { array, wasString } = coerceObjectArray(field.value)
  if (!array) throw new OrchestrationError('validation', 'Reference tool collection does not exist')
  let parent: unknown = array
  for (const key of occurrence.valuePath.slice(0, -1)) {
    if (
      ['__proto__', 'prototype', 'constructor'].includes(String(key)) ||
      (!isRecordLike(parent) && !Array.isArray(parent)) ||
      !Object.hasOwn(parent, key)
    ) {
      throw new OrchestrationError('validation', 'Invalid reference path')
    }
    parent = (parent as Record<string | number, unknown>)[key]
  }
  const last = occurrence.valuePath.at(-1)!
  if (['__proto__', 'prototype', 'constructor'].includes(String(last)) || !isRecordLike(parent)) {
    throw new OrchestrationError('validation', 'Invalid reference field')
  }
  parent[last] = value
  field.value = (
    wasString ? JSON.stringify(array) : array
  ) as BlockState['subBlocks'][string]['value']
}

/** Moves portable locators with the legacy MCP fields that workflow parsing normalizes. */
function normalizePortableMcpReferences(
  state: WorkflowState,
  manifest: WorkflowReferenceManifest,
  rawState: unknown
): WorkflowReferenceManifest {
  const rawBlocks = isRecordLike(rawState) ? rawState.blocks : undefined
  return {
    ...manifest,
    references: manifest.references.map((reference) => ({
      ...reference,
      occurrences: reference.occurrences.map((occurrence) => {
        const rawBlock = isRecordLike(rawBlocks) ? rawBlocks[occurrence.blockId] : undefined
        const block = state.blocks[occurrence.blockId]
        if (
          !block ||
          block.type !== 'mcp' ||
          !isRecordLike(rawBlock) ||
          !isRecordLike(rawBlock.subBlocks) ||
          !Object.hasOwn(rawBlock.subBlocks, occurrence.subBlockKey) ||
          (occurrence.subBlockKey !== 'server' && occurrence.subBlockKey !== 'tool') ||
          occurrence.valuePath.length !== 0
        )
          return occurrence
        const saved: Record<string, unknown> = {}
        for (const [key, field] of Object.entries(rawBlock.subBlocks))
          if (isRecordLike(field)) saved[key] = field.value
        if (
          Object.hasOwn(saved, `${occurrence.subBlockKey}Selector`) ||
          Object.hasOwn(saved, `${occurrence.subBlockKey}Reference`)
        )
          return occurrence
        if (
          occurrence.subBlockKey === 'server' &&
          saved.connection != null &&
          saved.connection !== ''
        )
          throw new OrchestrationError(
            'validation',
            'Legacy MCP parent server references must be replaced with the selected connection'
          )
        if (reference.kind === 'mcp-server' && occurrence.subBlockKey === 'server')
          saved.server = reference.sourceId
        const normalized = normalizeMcpBlockValues(saved)
        const subBlockKey =
          occurrence.subBlockKey +
          (normalized.canonicalModes[occurrence.subBlockKey] === 'advanced'
            ? 'Reference'
            : 'Selector')
        if (reference.kind === 'mcp-server' && occurrence.subBlockKey === 'server') {
          const toolKey =
            normalized.canonicalModes.tool === 'advanced' ? 'toolReference' : 'toolSelector'
          if (block.subBlocks[toolKey])
            block.subBlocks[toolKey].value = normalized.values[
              toolKey
            ] as BlockState['subBlocks'][string]['value']
        }
        return { ...occurrence, subBlockKey }
      }),
    })),
  }
}

export function parsePortableWorkflow(workflow: string | Record<string, unknown>): {
  state: WorkflowState
  manifest?: WorkflowReferenceManifest
} {
  const text = typeof workflow === 'string' ? workflow : JSON.stringify(workflow)
  if (Buffer.byteLength(text, 'utf8') > 10 * 1024 * 1024)
    throw new OrchestrationError('payload_too_large', 'Workflow exceeds 10 MiB')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new OrchestrationError('validation', 'Workflow must contain valid JSON')
  }
  if (isRecordLike(payload) && isRecordLike(payload.data)) payload = payload.data
  const parsed = parseWorkflowJson(text, false)
  if (!parsed.data || parsed.errors.length)
    throw new OrchestrationError('validation', `Invalid workflow: ${parsed.errors.join(', ')}`)
  const state = {
    ...parsed.data,
    variables: normalizeImportedVariables(
      parsed.data.variables,
      (index) => `@import/variable/${index}`
    ),
  }
  const variableEntries = Object.values(parsed.data.variables ?? {}).filter(
    (value) => value && typeof value === 'object'
  )
  if (Object.keys(state.variables).length !== variableEntries.length)
    throw new OrchestrationError(
      'validation',
      'Imported variables contain duplicate source identifiers'
    )
  if (Object.keys(state.variables).some((id) => Object.hasOwn(state.blocks, id)))
    throw new OrchestrationError(
      'validation',
      'Imported block and variable identifiers must be distinct'
    )
  const sourceIds = new Set([...Object.keys(state.blocks), ...Object.keys(state.variables)])
  for (const edge of state.edges) {
    if (!edge.id) continue
    if (sourceIds.has(edge.id))
      throw new OrchestrationError('validation', 'Imported graph identifiers must be distinct')
    sourceIds.add(edge.id)
  }
  const validation = workflowStateSchema.safeParse(state)
  if (!validation.success)
    throw new OrchestrationError(
      'validation',
      `Invalid workflow: ${validation.error.issues[0]?.message}`
    )
  if (Object.keys(state.blocks).length > 2000 || state.edges.length > 10000)
    throw new OrchestrationError('payload_too_large', 'Workflow exceeds the block or edge limit')
  for (const [id, block] of Object.entries(state.blocks)) {
    if (id !== block.id || ['__proto__', 'prototype', 'constructor'].includes(id))
      throw new OrchestrationError(
        'validation',
        'Block keys must match their source IDs and cannot use prototype names'
      )
  }
  const rawManifest = isRecordLike(payload) ? payload.referenceManifest : undefined
  const manifest =
    rawManifest === undefined
      ? undefined
      : normalizePortableMcpReferences(
          state,
          workflowReferenceManifestSchema.parse(rawManifest),
          isRecordLike(payload) && isRecordLike(payload.state) ? payload.state : payload
        )
  return { state, manifest }
}

/** Explicit mappings take precedence over inline code; otherwise the declaration is self-contained. */
function prepareInlineDeclarations(
  state: WorkflowState,
  options: MappedImportOptions
): Set<string> {
  const inline = new Set<string>()
  for (const block of Object.values(state.blocks))
    for (const [key, field] of Object.entries(block.subBlocks)) {
      if (
        !getBlock(block.type)?.subBlocks.some(
          (definition) => definition.id === key && definition.type === 'tool-input'
        )
      )
        continue
      const { array, wasString } = coerceObjectArray(field.value)
      if (!array) continue
      array.forEach((tool, index) => {
        if (!isRecordLike(tool) || tool.type !== 'custom-tool' || (!tool.code && !tool.schema))
          return
        const occurrence = {
          blockId: block.id,
          subBlockKey: key,
          valuePath: [index, 'customToolId'],
        }
        const explicit =
          options.mappings?.some(
            (mapping) => mapping.kind === 'custom-tool' && mapping.sourceId === tool.customToolId
          ) ||
          options.bindings?.some(
            (binding) =>
              binding.kind === 'custom-tool' &&
              referenceOccurrenceKey(binding) === referenceOccurrenceKey(occurrence)
          )
        if (explicit) {
          array[index] = omit(tool, ['code', 'schema'])
        } else {
          array[index] = omit(tool, ['customToolId', 'toolId'])
          inline.add(referenceOccurrenceKey(occurrence))
        }
      })
      field.value = (wasString ? JSON.stringify(array) : array) as typeof field.value
    }
  return inline
}

/** Plans entirely from the supplied document; provenance never triggers a source lookup. */
export function buildWorkflowImportPlan(
  workflow: string | Record<string, unknown>,
  options: MappedImportOptions
): WorkflowImportPlan {
  const parsed = parsePortableWorkflow(workflow)
  const source = structuredClone(parsed.state)
  const inline = prepareInlineDeclarations(source, options)
  const manifest = parsed.manifest ?? buildWorkflowReferenceManifest(source.blocks)
  const references: PortableReference[] = structuredClone(manifest.references)
    .map((reference) => ({
      ...reference,
      occurrences: reference.occurrences.filter(
        (occurrence) =>
          reference.kind !== 'custom-tool' || !inline.has(referenceOccurrenceKey(occurrence))
      ),
    }))
    .filter((reference) => reference.occurrences.length)
  for (const detected of buildWorkflowReferenceManifest(source.blocks).references) {
    const existing = references.find(
      (entry) => entry.kind === detected.kind && entry.sourceId === detected.sourceId
    )
    if (!existing) references.push(detected)
    else
      for (const occurrence of detected.occurrences) {
        if (
          !existing.occurrences.some(
            (entry) => referenceOccurrenceKey(entry) === referenceOccurrenceKey(occurrence)
          )
        )
          existing.occurrences.push(occurrence)
      }
  }
  const explicit = new Map<string, ImportFieldBinding>()
  for (const binding of options.bindings ?? []) {
    const key = referenceOccurrenceKey(binding)
    if (explicit.has(key))
      throw new OrchestrationError('validation', 'A source field has duplicate bindings')
    explicit.set(key, binding)
    if (
      !references.some((reference) =>
        reference.occurrences.some((occurrence) => referenceOccurrenceKey(occurrence) === key)
      )
    ) {
      const { kind, targetId: _targetId, ...occurrence } = binding
      references.push({
        kind,
        sourceId: `legacy-binding-${references.length}`,
        required: true,
        occurrences: [occurrence],
      })
    }
  }
  const groups = new Map<
    string,
    { occurrence: ReferenceOccurrence; references: PortableReference[] }
  >()
  for (const reference of references)
    for (const occurrence of reference.occurrences) {
      const key = referenceOccurrenceKey(occurrence)
      const group = groups.get(key) ?? { occurrence, references: [] }
      if (group.occurrence.encoding !== occurrence.encoding)
        throw new OrchestrationError('validation', 'Conflicting reference encodings')
      group.references.push({ ...reference, occurrences: [occurrence] })
      groups.set(key, group)
    }
  for (const { occurrence, references: entries } of groups.values()) {
    if (occurrence.encoding !== 'environment') {
      const ids: string[] = []
      entries.forEach((reference, index) => {
        for (const position of reference.occurrences[0].positions ?? [index]) {
          if (ids[position] && ids[position] !== reference.sourceId)
            throw new OrchestrationError('validation', 'Conflicting resource positions')
          ids[position] = reference.sourceId
        }
      })
      writeOccurrence(
        source.blocks,
        occurrence,
        encodeIdentifiers(
          ids.filter((id) => id !== undefined),
          occurrence.encoding
        )
      )
    }
  }
  const discovered = buildWorkflowReferenceManifest(source.blocks)
  for (const reference of references)
    for (const occurrence of reference.occurrences) {
      if (
        !discovered.references.some(
          (entry) =>
            entry.kind === reference.kind &&
            entry.sourceId === reference.sourceId &&
            entry.occurrences.some(
              (actual) => referenceOccurrenceKey(actual) === referenceOccurrenceKey(occurrence)
            )
        )
      ) {
        throw new OrchestrationError(
          'validation',
          'Reference does not address a registered resource field'
        )
      }
    }
  const mappings = new Map<string, string | null>()
  for (const mapping of options.mappings ?? []) {
    const key = JSON.stringify([mapping.kind, mapping.sourceId])
    if (mappings.has(key)) throw new OrchestrationError('validation', 'Duplicate resource mapping')
    if (
      !references.some(
        (entry) => entry.kind === mapping.kind && entry.sourceId === mapping.sourceId
      )
    )
      throw new OrchestrationError('validation', 'Mapping source is not referenced by the workflow')
    mappings.set(key, mapping.targetId)
  }
  const bindings: ImportBindingResolution[] = []
  const state = structuredClone(source)
  for (const { occurrence, references: entries } of groups.values()) {
    entries.forEach((reference) => {
      const key = JSON.stringify([reference.kind, reference.sourceId])
      const field = explicit.get(referenceOccurrenceKey(occurrence))
      if (
        field &&
        (field.kind !== reference.kind ||
          (mappings.has(key) && mappings.get(key) !== field.targetId))
      )
        throw new OrchestrationError(
          'validation',
          'Resource mapping conflicts with an explicit field binding'
        )
      const targetId = field?.targetId ?? mappings.get(key) ?? null
      const registered = discovered.references.find(
        (entry) => entry.kind === reference.kind && entry.sourceId === reference.sourceId
      )!
      bindings.push({
        kind: reference.kind,
        sourceId: reference.sourceId,
        targetId,
        required: registered.required,
        occurrence,
      })
    })
  }
  const seenDependents = new Set<string>()
  for (const value of options.dependentValues ?? []) {
    const key = JSON.stringify([value.blockId, value.subBlockKey])
    if (!Object.hasOwn(state.blocks, value.blockId) || seenDependents.has(key))
      throw new OrchestrationError('validation', 'Invalid or duplicate dependent field')
    seenDependents.add(key)
  }
  for (const block of Object.values(state.blocks)) {
    const fields: SubBlockRecord = {}
    for (const [key, field] of Object.entries(block.subBlocks)) fields[key] = { ...field }
    const blockBindings = bindings.filter((binding) => binding.occurrence.blockId === block.id)
    const resolve = (
      kind: PortableResourceKind,
      sourceId: string,
      path: Array<string | number> = ['type']
    ) => {
      const binding = blockBindings.find(
        (binding) =>
          binding.kind === kind &&
          binding.sourceId === sourceId &&
          JSON.stringify([binding.occurrence.subBlockKey, ...binding.occurrence.valuePath]) ===
            JSON.stringify(path)
      )
      return binding?.targetId ?? null
    }
    const context = {
      preserveToolIndices: true,
      blockId: block.id,
      blockType: block.type,
      canonicalModes: block.data?.canonicalModes,
      triggerMode: block.triggerMode,
    }
    const workflows = remapWorkflowReferencesInSubBlocks(fields, undefined, {
      clearUnmapped: true,
      preserveToolIndices: true,
      canonicalModes: block.data?.canonicalModes,
      resolve: (sourceId, path) => resolve('workflow', sourceId, path),
    })
    const remapped = remapSubBlocks(workflows, resolve, context)
    const cleared = clearDependentsOnRemap(
      remapped.subBlocks,
      block.type,
      remapped.remappedKeys,
      remapped.canonicalModes ?? block.data?.canonicalModes,
      undefined,
      block.triggerMode
    )
    const dependentValues = new Map(
      (options.dependentValues ?? [])
        .filter((value) => value.blockId === block.id)
        .map((value) => [value.subBlockKey, value.value])
    )
    const targetType = remapForkBlockType(block.type, resolve).type
    const applied =
      targetType !== block.type
        ? replaceCustomBlockInputs(cleared, dependentValues, targetType)
        : applyDependentOverrides(cleared, block.type, dependentValues)
    block.type = targetType
    if (remapped.canonicalModes) {
      const canonicalModes: Record<string, 'basic' | 'advanced'> = {}
      for (const [key, mode] of Object.entries(remapped.canonicalModes))
        if (mode) canonicalModes[key] = mode
      block.data = { ...block.data, canonicalModes }
    }
    const next: BlockState['subBlocks'] = {}
    for (const [key, field] of Object.entries(applied)) {
      next[key] = {
        id: key,
        type:
          typeof field.type === 'string'
            ? (field.type as BlockState['subBlocks'][string]['type'])
            : 'short-input',
        value: field.value as BlockState['subBlocks'][string]['value'],
      }
    }
    block.subBlocks = next
  }
  return {
    sourceState: source,
    state,
    manifest: { version: 1, references },
    bindings,
    unresolvedBindings: bindings.filter((binding) => binding.required && !binding.targetId),
  }
}
