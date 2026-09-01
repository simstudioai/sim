export const OUTPUT_SCOPE_SEPARATOR = '/'
const INTERNAL_OUTPUT_PATH_SEPARATOR = '_'
const PUBLIC_OUTPUT_PATH_SEPARATOR = '.'

export interface ParsedOutputSelector {
  /** Invocation-scoped block ID, such as `workflow-block/agent-block`. */
  blockId: string
  /** Dot path within the selected block output. Empty selects the whole block. */
  path: string
}

function assertValidScopedBlockId(blockId: string): void {
  if (!blockId || blockId.trim() !== blockId) {
    throw new Error(`Invalid output selector block ID: ${blockId}`)
  }
  const segments = blockId.split(OUTPUT_SCOPE_SEPARATOR)
  if (segments.some((segment) => !segment || segment.trim() !== segment)) {
    throw new Error(`Invalid scoped output selector block ID: ${blockId}`)
  }
}

function parseOutputSelectorWithSeparator(
  selector: string,
  separator: typeof INTERNAL_OUTPUT_PATH_SEPARATOR | typeof PUBLIC_OUTPUT_PATH_SEPARATOR
): ParsedOutputSelector {
  if (!selector || selector.trim() !== selector) {
    throw new Error(`Invalid output selector: ${selector}`)
  }

  const separatorIndex = selector.indexOf(separator)
  const blockId = separatorIndex > 0 ? selector.slice(0, separatorIndex) : selector
  const path = separatorIndex > 0 ? selector.slice(separatorIndex + 1) : ''

  assertValidScopedBlockId(blockId)
  if (separatorIndex === 0 || (separatorIndex > 0 && !path)) {
    throw new Error(`Invalid output selector: ${selector}`)
  }

  return { blockId, path }
}

/** Parses the caller-facing `blockId.path` selector form. */
export function parsePublicOutputSelector(selector: string): ParsedOutputSelector {
  return parseOutputSelectorWithSeparator(selector, PUBLIC_OUTPUT_PATH_SEPARATOR)
}

/** Parses the executor-internal `blockId_path` selector form. */
export function parseInternalOutputSelector(selector: string): ParsedOutputSelector {
  return parseOutputSelectorWithSeparator(selector, INTERNAL_OUTPUT_PATH_SEPARATOR)
}

/**
 * Parses selectors persisted by the output picker before and after dot-form
 * authoring became canonical.
 */
export function parseStoredOutputSelector(selector: string): ParsedOutputSelector {
  const underscoreIndex = selector.indexOf(INTERNAL_OUTPUT_PATH_SEPARATOR)
  const dotIndex = selector.indexOf(PUBLIC_OUTPUT_PATH_SEPARATOR)
  return underscoreIndex > 0 && (dotIndex < 0 || underscoreIndex < dotIndex)
    ? parseInternalOutputSelector(selector)
    : parsePublicOutputSelector(selector)
}

function formatOutputSelectorWithSeparator(
  blockId: string,
  path: string,
  separator: typeof INTERNAL_OUTPUT_PATH_SEPARATOR | typeof PUBLIC_OUTPUT_PATH_SEPARATOR
): string {
  assertValidScopedBlockId(blockId)
  if (path.trim() !== path || path.startsWith('.') || path.endsWith('.')) {
    throw new Error(`Invalid output selector path: ${path}`)
  }
  return path ? `${blockId}${separator}${path}` : blockId
}

/** Formats the caller-facing selector stored in authoring state and sent over APIs. */
export function formatPublicOutputSelector(blockId: string, path = ''): string {
  return formatOutputSelectorWithSeparator(blockId, path, PUBLIC_OUTPUT_PATH_SEPARATOR)
}

/** Formats the canonical internal selector consumed by the executor. */
export function formatInternalOutputSelector(blockId: string, path = ''): string {
  return formatOutputSelectorWithSeparator(blockId, path, INTERNAL_OUTPUT_PATH_SEPARATOR)
}

/** Parses persisted authoring selectors in both the legacy internal and public forms. */
export const parseOutputSelector = parseStoredOutputSelector

/** Formats selectors for the executor's legacy internal contract. */
export const formatOutputSelector = formatInternalOutputSelector

export function scopeOutputBlockId(parentBlockId: string, childBlockId: string): string {
  assertValidScopedBlockId(parentBlockId)
  assertValidScopedBlockId(childBlockId)
  return `${parentBlockId}${OUTPUT_SCOPE_SEPARATOR}${childBlockId}`
}

/**
 * Returns only selections addressed to a workflow-block invocation and removes
 * that invocation segment before handing them to its child executor.
 */
export function selectChildOutputSelectors(
  parentBlockId: string,
  selectedOutputs: readonly string[] | undefined
): string[] {
  assertValidScopedBlockId(parentBlockId)
  const prefix = `${parentBlockId}${OUTPUT_SCOPE_SEPARATOR}`
  const childSelectors: string[] = []

  for (const selector of selectedOutputs ?? []) {
    const parsed = parseInternalOutputSelector(selector)
    if (!parsed.blockId.startsWith(prefix)) continue
    const childBlockId = parsed.blockId.slice(prefix.length)
    childSelectors.push(formatInternalOutputSelector(childBlockId, parsed.path))
  }

  return childSelectors
}
