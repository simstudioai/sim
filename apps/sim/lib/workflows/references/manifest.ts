import { isRecordLike } from '@sim/utils/object'
import {
  coerceObjectArray,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import { fileUploadReferencePositions } from '@/lib/workflows/references/remap-files'
import {
  createCanonicalModeGates,
  remapForkBlockType,
  remapSubBlocks,
} from '@/lib/workflows/references/remap-references'
import type {
  PortableResourceKind,
  ReferenceOccurrence,
  WorkflowReferenceManifest,
} from '@/lib/workflows/references/types'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Reads only an existing, explicitly addressed field; never follows prototype properties. */
export function readReferenceValue(value: unknown, path: Array<string | number>): unknown {
  let current = value
  for (const key of path) {
    if (typeof current === 'string') {
      const parsed = coerceObjectArray(current)
      current = parsed.array
    }
    if ((!isRecordLike(current) && !Array.isArray(current)) || !Object.hasOwn(current, key)) {
      return undefined
    }
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/** The manifest contains identifiers and locators only, never copied field values. */
export function buildWorkflowReferenceManifest(
  blocks: Record<string, BlockState>
): WorkflowReferenceManifest {
  const references = new Map<string, WorkflowReferenceManifest['references'][number]>()
  const record = (
    kind: PortableResourceKind,
    sourceId: string,
    required: boolean,
    occurrence: ReferenceOccurrence
  ) => {
    if (
      !sourceId ||
      sourceId.length > 4096 ||
      /[\r\n?&#=]/.test(sourceId) ||
      sourceId.includes('://') ||
      [occurrence.blockId, occurrence.subBlockKey, ...occurrence.valuePath].some(
        (key) => key === '__proto__' || key === 'prototype' || key === 'constructor'
      )
    )
      return
    const key = JSON.stringify([kind, sourceId])
    const entry = references.get(key) ?? { kind, sourceId, required, occurrences: [] }
    if (
      !entry.occurrences.some((existing) => JSON.stringify(existing) === JSON.stringify(occurrence))
    ) {
      entry.occurrences.push(occurrence)
    }
    references.set(key, entry)
  }
  for (const block of Object.values(blocks)) {
    const custom = remapForkBlockType(block.type, (_kind, id) => id)
    if (custom.reference)
      record('custom-block', block.type, true, {
        blockId: block.id,
        subBlockKey: 'type',
        valuePath: [],
        encoding: 'scalar',
      })
    const context = {
      registeredReferencesOnly: true,
      blockId: block.id,
      blockType: block.type,
      canonicalModes: block.data?.canonicalModes,
      triggerMode: block.triggerMode,
    }
    const subBlocks: SubBlockRecord = {}
    for (const [key, field] of Object.entries(block.subBlocks)) subBlocks[key] = { ...field }
    const result = remapSubBlocks(subBlocks, (_kind, id) => id, context)
    for (const reference of result.occurrences) {
      const valuePath = reference.valuePath ?? []
      const value = readReferenceValue(block.subBlocks[reference.subBlockKey]?.value, valuePath)
      const encoding =
        reference.kind === 'env-var'
          ? 'environment'
          : reference.kind === 'file'
            ? 'files'
            : Array.isArray(value)
              ? 'array'
              : typeof value === 'string' && value.includes(',')
                ? 'csv'
                : 'scalar'
      let values: unknown[] = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',').map((part) => part.trim())
          : [value]
      if (reference.kind === 'file') {
        const decoded = coerceObjectArray(value).array
        values = (decoded ?? (Array.isArray(value) ? value : [value])).map((file) =>
          isRecordLike(file) ? (file.key ?? file.path ?? file.name) : undefined
        )
      }
      const positions =
        reference.kind === 'file'
          ? fileUploadReferencePositions(value, reference.sourceId)
          : values.flatMap((entry, index) => (entry === reference.sourceId ? [index] : []))
      record(reference.kind, reference.sourceId, reference.required, {
        blockId: block.id,
        subBlockKey: reference.subBlockKey,
        valuePath,
        encoding,
        positions,
      })
    }
    const gates = createCanonicalModeGates(
      getBlock(block.type)?.subBlocks,
      buildSubBlockValues(block.subBlocks),
      block.data?.canonicalModes,
      block.triggerMode === true
    )
    for (const [key, field] of Object.entries(block.subBlocks)) {
      const definition = getBlock(block.type)?.subBlocks.find(
        (candidate) => candidate.id === key || candidate.canonicalParamId === key
      )
      if (!definition) continue
      if (
        gates.isDormantMember(key) ||
        gates.isConditionHidden(key) ||
        gates.isActiveManualMember(key)
      )
        continue
      if (
        definition.type === 'workflow-selector' ||
        definition.selectorKey === 'sim.workflows' ||
        (key === 'workflowIds' && definition.type === 'dropdown')
      ) {
        const ids = Array.isArray(field.value)
          ? field.value
          : typeof field.value === 'string'
            ? field.value.split(',')
            : []
        for (const id of ids)
          if (typeof id === 'string' && id.trim() && !/[<>]/.test(id)) {
            record('workflow', id.trim(), true, {
              blockId: block.id,
              subBlockKey: key,
              valuePath: [],
              positions: ids.flatMap((value, index) => (value === id ? [index] : [])),
              encoding: Array.isArray(field.value) ? 'array' : ids.length > 1 ? 'csv' : 'scalar',
            })
          }
      }
      if (definition.type === 'tool-input') {
        const { array } = coerceObjectArray(field.value)
        array?.forEach((tool, index) => {
          if (
            isRecordLike(tool) &&
            tool.type === 'workflow_input' &&
            isRecordLike(tool.params) &&
            typeof tool.params.workflowId === 'string'
          ) {
            record('workflow', tool.params.workflowId, true, {
              blockId: block.id,
              subBlockKey: key,
              valuePath: [index, 'params', 'workflowId'],
              encoding: 'scalar',
            })
          }
        })
      }
    }
  }
  return { version: 1, references: [...references.values()] }
}
