import { isValidUuid } from '@sim/utils/id'
import type { BlockState } from '@sim/workflow-types/workflow'
import { normalizeName } from '@/executor/constants'

const INTERNAL_OUTPUT_PATH_SEPARATOR = '_'
const PUBLIC_OUTPUT_PATH_SEPARATOR = '.'

export interface ParsedOutputSelector {
  /** Child workflow containing the selected block. Omitted for the current workflow. */
  workflowId?: string
  /** Stable block ID internally, or normalized block name at a public boundary. */
  blockId: string
  /** Dot path within the selected block output. Empty selects the whole block. */
  path: string
}

export interface PublicOutputSelectorContext {
  /** IDs and normalized names belonging to the workflow being executed. */
  currentBlockRefs: ReadonlySet<string>
  /** Known reachable child workflows. UUID workflow IDs are also recognized without preloading. */
  childWorkflowIds?: ReadonlySet<string>
}

export interface ChildOutputSelection {
  selectedOutputs: string[]
  /** Actual child block ID to the caller-supplied ref used in the scoped selector. */
  selectedBlockRefs: ReadonlyMap<string, string>
  targetsChildWorkflow: boolean
}

function assertValidSelectorPart(value: string, label: string): void {
  if (!value || value.trim() !== value || value.includes('/') || value.includes('.')) {
    throw new Error(`Invalid output selector ${label}: ${value}`)
  }
}

function assertValidOutputPath(path: string): void {
  if (
    path.trim() !== path ||
    path
      .split(PUBLIC_OUTPUT_PATH_SEPARATOR)
      .some((segment) => !segment || segment.trim() !== segment)
  ) {
    throw new Error(`Invalid output selector path: ${path}`)
  }
}

function assertSelector(selector: string): void {
  if (!selector || selector.trim() !== selector || selector.includes('/')) {
    throw new Error(`Invalid output selector: ${selector}`)
  }
}

function decodeInternalSelectorPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`Invalid encoded output selector part: ${value}`)
  }
}

function encodeInternalSelectorPart(value: string): string {
  assertValidSelectorPart(value, 'part')
  return encodeURIComponent(value).replaceAll(INTERNAL_OUTPUT_PATH_SEPARATOR, '%5F')
}

function parseScopedBlockRef(
  value: string,
  decodeInternal = false
): Pick<ParsedOutputSelector, 'workflowId' | 'blockId'> {
  const segments = value.split(PUBLIC_OUTPUT_PATH_SEPARATOR)
  if (segments.length > 2) {
    throw new Error(`Invalid output selector block reference: ${value}`)
  }
  const [rawFirst, rawSecond] = segments
  const first = decodeInternal ? decodeInternalSelectorPart(rawFirst) : rawFirst
  const second = rawSecond
    ? decodeInternal
      ? decodeInternalSelectorPart(rawSecond)
      : rawSecond
    : undefined
  if (!first || (segments.length === 2 && !second)) {
    throw new Error(`Invalid output selector block reference: ${value}`)
  }
  if (second) {
    assertValidSelectorPart(first, 'workflow ID')
    assertValidSelectorPart(second, 'block reference')
    return { workflowId: first, blockId: second }
  }
  assertValidSelectorPart(first, 'block reference')
  return { blockId: first }
}

/** Parses caller-facing selectors using the current workflow to disambiguate dot paths. */
export function parsePublicOutputSelector(
  selector: string,
  context?: PublicOutputSelectorContext
): ParsedOutputSelector {
  assertSelector(selector)
  const segments = selector.split(PUBLIC_OUTPUT_PATH_SEPARATOR)
  if (segments.some((segment) => !segment || segment.trim() !== segment)) {
    throw new Error(`Invalid output selector: ${selector}`)
  }

  const [first, second, ...pathSegments] = segments
  assertValidSelectorPart(first, 'block reference')
  if (!second) return { blockId: first, path: '' }

  if (context?.currentBlockRefs.has(first)) {
    const path = [second, ...pathSegments].join(PUBLIC_OUTPUT_PATH_SEPARATOR)
    assertValidOutputPath(path)
    return { blockId: first, path }
  }

  const selectsChildWorkflow = context?.childWorkflowIds?.has(first) === true || isValidUuid(first)
  if (context && selectsChildWorkflow && pathSegments.length > 0) {
    assertValidSelectorPart(second, 'block reference')
    const path = pathSegments.join(PUBLIC_OUTPUT_PATH_SEPARATOR)
    assertValidOutputPath(path)
    return { workflowId: first, blockId: second, path }
  }

  const path = [second, ...pathSegments].join(PUBLIC_OUTPUT_PATH_SEPARATOR)
  assertValidOutputPath(path)
  return { blockId: first, path }
}

/** Parses the executor-internal `blockId_path` or `workflowId.blockId_path` form. */
export function parseInternalOutputSelector(selector: string): ParsedOutputSelector {
  assertSelector(selector)
  const separatorIndex = selector.indexOf(INTERNAL_OUTPUT_PATH_SEPARATOR)
  const scopedBlockRef = separatorIndex > 0 ? selector.slice(0, separatorIndex) : selector
  const path = separatorIndex > 0 ? selector.slice(separatorIndex + 1) : ''
  if (separatorIndex === 0 || (separatorIndex > 0 && !path)) {
    throw new Error(`Invalid output selector: ${selector}`)
  }
  const parsed = parseScopedBlockRef(scopedBlockRef, true)
  if (parsed.workflowId && !path) {
    throw new Error(`Nested output selector is missing its output path: ${selector}`)
  }
  if (path) assertValidOutputPath(path)
  return { ...parsed, path }
}

/** Parses output-picker state, whose canonical form is the internal selector form. */
export function parseStoredOutputSelector(
  selector: string,
  context?: PublicOutputSelectorContext
): ParsedOutputSelector {
  const separatorIndex = selector.indexOf(INTERNAL_OUTPUT_PATH_SEPARATOR)
  if (separatorIndex > 0) {
    const scopedBlockRef = selector.slice(0, separatorIndex)
    const scopedSegments = scopedBlockRef.split(PUBLIC_OUTPUT_PATH_SEPARATOR)
    const isCurrentStableBlock = context?.currentBlockRefs.has(scopedBlockRef) === true
    const isChildStableBlock =
      scopedSegments.length === 2 &&
      isValidUuid(scopedSegments[0]) &&
      isValidUuid(scopedSegments[1])
    const isEncodedInternalBlock = scopedBlockRef.includes('%')
    if (isCurrentStableBlock || isChildStableBlock || isEncodedInternalBlock || !context) {
      return parseInternalOutputSelector(selector)
    }
  }
  return parsePublicOutputSelector(selector, context)
}

function formatPublicScopedBlockRef(blockId: string, workflowId?: string): string {
  assertValidSelectorPart(blockId, 'block reference')
  if (!workflowId) return blockId
  assertValidSelectorPart(workflowId, 'workflow ID')
  return `${workflowId}${PUBLIC_OUTPUT_PATH_SEPARATOR}${blockId}`
}

function formatInternalScopedBlockRef(blockId: string, workflowId?: string): string {
  const encodedBlockId = encodeInternalSelectorPart(blockId)
  if (!workflowId) return encodedBlockId
  return `${encodeInternalSelectorPart(workflowId)}${PUBLIC_OUTPUT_PATH_SEPARATOR}${encodedBlockId}`
}

/** Formats the caller-facing `block.path` or `workflow.block.path` selector. */
export function formatPublicOutputSelector(
  blockId: string,
  path = '',
  workflowId?: string
): string {
  if (workflowId && !path) {
    throw new Error('Nested output selectors require an output path')
  }
  const scopedBlockRef = formatPublicScopedBlockRef(blockId, workflowId)
  if (path) assertValidOutputPath(path)
  return path ? `${scopedBlockRef}${PUBLIC_OUTPUT_PATH_SEPARATOR}${path}` : scopedBlockRef
}

/** Formats the canonical `block_path` or `workflow.block_path` executor selector. */
export function formatInternalOutputSelector(
  blockId: string,
  path = '',
  workflowId?: string
): string {
  if (workflowId && !path) {
    throw new Error('Nested output selectors require an output path')
  }
  const scopedBlockRef = formatInternalScopedBlockRef(blockId, workflowId)
  if (path) assertValidOutputPath(path)
  return path ? `${scopedBlockRef}${INTERNAL_OUTPUT_PATH_SEPARATOR}${path}` : scopedBlockRef
}

export const formatOutputSelector = formatInternalOutputSelector

/** Creates the external block identity emitted by a selected child workflow. */
export function scopeOutputBlockId(workflowId: string, childBlockId: string): string {
  if (childBlockId.includes(PUBLIC_OUTPUT_PATH_SEPARATOR)) {
    parseScopedBlockRef(childBlockId, true)
    return childBlockId
  }
  return formatInternalScopedBlockRef(childBlockId, workflowId)
}

export function resolveOutputBlockRef(
  blockRef: string,
  blocks: Record<string, { id: string; name?: string }>
): string {
  const exact = blocks[blockRef]
  if (exact) return exact.id

  const blockValues = Object.values(blocks)
  const idMatches = blockValues.filter((block) => block.id === blockRef)
  if (idMatches.length === 1) return idMatches[0].id

  const normalizedRef = normalizeName(blockRef)
  const matches = blockValues.filter((block) => normalizeName(block.name || '') === normalizedRef)
  if (matches.length !== 1) {
    throw new Error(`Selected output block does not resolve: ${blockRef}`)
  }
  return matches[0].id
}

/** Routes workflow-scoped selections into a child executor. */
export function selectChildOutputSelectors(
  childWorkflowId: string,
  childBlocks: Record<string, BlockState>,
  selectedOutputs: readonly string[] | undefined
): ChildOutputSelection {
  assertValidSelectorPart(childWorkflowId, 'workflow ID')
  const childSelectors: string[] = []
  const selectedBlockRefs = new Map<string, string>()
  let targetsChildWorkflow = false

  for (const selector of selectedOutputs ?? []) {
    const parsed = parseInternalOutputSelector(selector)
    if (!parsed.workflowId) continue
    if (parsed.workflowId !== childWorkflowId) {
      childSelectors.push(selector)
      continue
    }

    targetsChildWorkflow = true
    const childBlockId = resolveOutputBlockRef(parsed.blockId, childBlocks)
    selectedBlockRefs.set(childBlockId, parsed.blockId)
    childSelectors.push(formatInternalOutputSelector(childBlockId, parsed.path))
  }

  return { selectedOutputs: childSelectors, selectedBlockRefs, targetsChildWorkflow }
}
