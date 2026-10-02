import { isRecordLike, omit } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import { shapeSubBlockValue } from '@/lib/workflows/canonical/subblock-value'
import { normalizedStringify } from '@/lib/workflows/comparison/normalize'
import { getConditionRows, getRouterRows } from '@/lib/workflows/dynamic-handle-topology'
import { resolveSubBlockOptions } from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'

export type SubBlockPresentationKind =
  | 'structured'
  | 'text'
  | 'scalar'
  | 'secret'
  | 'json'
  | 'display'

export interface StructuredValueRow {
  /** Unmasked comparison identity; never use this value as a React key or render it. */
  key: string
  cells: Record<string, unknown>
}

export interface StructuredValuePresentation {
  columns: string[]
  rows: StructuredValueRow[]
  /** Preserves a storage change even when decoding produces identical displayed rows. */
  encoding?: 'json-text' | 'structured'
  sourceKey?: string
}

type Presenter = (
  value: unknown,
  config: SubBlockConfig,
  values: Record<string, unknown>
) => StructuredValuePresentation
interface PresentationDefinition {
  kind: SubBlockPresentationKind | 'selection'
  present?: Presenter
}

type Projection = readonly (readonly [field: string, label: string])[]

function row(value: unknown, cells: Record<string, unknown>, role?: string): StructuredValueRow {
  return { key: normalizedStringify({ value, ...(role ? { role } : {}) }), cells }
}

function valuePresentation(value: unknown): StructuredValuePresentation {
  return { columns: ['Value'], rows: value == null ? [] : [row(value, { Value: value })] }
}

function columnsFor(rows: StructuredValueRow[], preferred: string[]): string[] {
  return [...new Set([...preferred, ...rows.flatMap((entry) => Object.keys(entry.cells))])]
}

function withDetails(
  cells: Record<string, unknown>,
  value: Record<string, unknown>,
  displayedKeys: string[],
  hiddenKeys: string[] = [],
  reservedLabels: string[] = []
): Record<string, unknown> {
  const details = omit(value, [...displayedKeys, ...hiddenKeys])
  if (Object.keys(details).length === 0) return cells
  let label = 'Details'
  while (Object.hasOwn(cells, label) || reservedLabels.includes(label))
    label = `Additional ${label}`
  return { ...cells, [label]: details }
}

function projectRows(value: unknown, fields: Projection): StructuredValuePresentation {
  if (!Array.isArray(value) || value.length === 0) return valuePresentation(value)
  const rows = value.map((entry) => {
    if (!isRecordLike(entry)) return row(entry, { Value: entry })
    const cells = Object.fromEntries(
      fields.flatMap(([field, label]) =>
        Object.hasOwn(entry, field) ? [[label, entry[field]]] : []
      )
    )
    return row(
      entry,
      withDetails(
        cells,
        entry,
        fields.map(([field]) => field)
      )
    )
  })
  return {
    columns: columnsFor(
      rows,
      fields.map(([, label]) => label)
    ),
    rows,
  }
}

function tablePresentation(value: unknown, config: SubBlockConfig): StructuredValuePresentation {
  if (value == null) return { columns: config.columns ?? [], rows: [] }
  if (!Array.isArray(value)) return mappingPresentation(value)
  const rows = value.map((entry) => {
    if (!isRecordLike(entry) || !isRecordLike(entry.cells)) return row(entry, { Value: entry })
    const cells = Object.fromEntries(Object.entries(entry.cells))
    return row(entry, withDetails(cells, entry, ['cells'], ['id'], config.columns))
  })
  return { columns: columnsFor(rows, config.columns ?? []), rows }
}

function branchPresentation(value: unknown, config: SubBlockConfig): StructuredValuePresentation {
  if (!Array.isArray(value) || value.length === 0) return valuePresentation(value)
  const condition = config.type === 'condition-input'
  const titles = condition
    ? getConditionRows(config.id, value).map((entry) => entry.title)
    : getRouterRows(config.id, value).map((_, index) => `Route ${index + 1}`)
  const description = condition ? 'Condition' : 'Description'
  const rows = value.map((entry, index) => {
    if (!isRecordLike(entry)) return row(entry, { Value: entry })
    const cells = {
      Branch: titles[index],
      ...(Object.hasOwn(entry, 'value') ? { [description]: entry.value } : {}),
    }
    return row(
      entry,
      withDetails(cells, entry, ['value'], ['id', 'title']),
      condition ? titles[index] : undefined
    )
  })
  return { columns: columnsFor(rows, ['Branch', description]), rows }
}

function selectionPresentation(
  value: unknown,
  config: SubBlockConfig,
  values: Record<string, unknown>
): StructuredValuePresentation {
  if (value == null) return { columns: ['Selection'], rows: [] }
  const entries = Array.isArray(value) ? value : [value]
  if (entries.length === 0) return valuePresentation(value)
  const options = resolveSubBlockOptions(config, values)
  const optionsById = new Map(options.map((option) => [option.id, option]))
  const labelCounts = new Map<string, number>()
  for (const option of options)
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1)
  const rows = entries.map((entry) => {
    const option = typeof entry === 'string' ? optionsById.get(entry) : undefined
    return row(entry, {
      Selection: option?.label ?? entry,
      ...(option && (labelCounts.get(option.label) ?? 0) > 1 ? { Identifier: entry } : {}),
    })
  })
  return { columns: columnsFor(rows, ['Selection']), rows }
}

function checkboxPresentation(
  value: unknown,
  config: SubBlockConfig,
  values: Record<string, unknown>
): StructuredValuePresentation {
  if (!isRecordLike(value) || Object.keys(value).length === 0) return valuePresentation(value)
  const options = resolveSubBlockOptions(config, values)
  const labelsById = new Map(options.map((option) => [option.id, option.label]))
  const rows = Object.entries(value)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, selected]) =>
      row({ key, selected }, { Option: labelsById.get(key) ?? key, Selected: selected })
    )
  return { columns: ['Option', 'Selected'], rows }
}

/** Named values use the same ordered field rows for subblock mappings and block settings. */
export function mappingPresentation(value: unknown): StructuredValuePresentation {
  if (!isRecordLike(value) || Object.keys(value).length === 0) return valuePresentation(value)
  return {
    columns: ['Field', 'Value'],
    rows: Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([field, entry]) => row({ field, value: entry }, { Field: field, Value: entry })),
  }
}

function decodeStructuredText(value: unknown): { value: unknown; encoded: boolean } {
  if (typeof value !== 'string') return { value, encoded: false }
  const first = value.trimStart()[0]
  if (first !== '[' && first !== '{') return { value, encoded: false }
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) || isRecordLike(parsed)) return { value: parsed, encoded: true }
  } catch {
    return { value, encoded: false }
  }
  return { value, encoded: false }
}

function toolsPresentation(value: unknown): StructuredValuePresentation {
  if (!Array.isArray(value) || value.length === 0) return valuePresentation(value)
  const rows = value.map((entry) => {
    if (!isRecordLike(entry)) return row(entry, { Value: entry })
    const configuration = omit(entry, typeof entry.title === 'string' ? ['title'] : [])
    return row(entry, {
      Tool: typeof entry.title === 'string' ? entry.title : entry.type,
      Configuration: configuration,
    })
  })
  return { columns: ['Tool', 'Configuration'], rows }
}

function filePresentation(value: unknown): StructuredValuePresentation {
  return projectRows(value == null || Array.isArray(value) ? value : [value], [
    ['name', 'File'],
    ['folderPath', 'Folder'],
    ['size', 'Size'],
    ['type', 'Type'],
    ['path', 'Path'],
  ])
}

const structured = (present: Presenter): PresentationDefinition => ({ kind: 'structured', present })
const selections: PresentationDefinition = { kind: 'selection', present: selectionPresentation }
const mapping = structured(mappingPresentation)
const text = { kind: 'text' } as const
const scalar = { kind: 'scalar' } as const

const PRESENTATIONS = {
  'short-input': scalar,
  'long-input': text,
  dropdown: selections,
  combobox: selections,
  slider: scalar,
  table: structured(tablePresentation),
  code: text,
  switch: scalar,
  'tool-input': structured(toolsPresentation),
  'skill-input': structured((value) =>
    projectRows(value, [
      ['name', 'Skill'],
      ['skillId', 'Skill ID'],
    ])
  ),
  'checkbox-list': structured(checkboxPresentation),
  'grouped-checkbox-list': selections,
  'condition-input': structured(branchPresentation),
  'eval-input': structured((value) =>
    projectRows(value, [
      ['name', 'Metric'],
      ['description', 'Description'],
      ['range', 'Range'],
    ])
  ),
  'time-input': scalar,
  'oauth-input': { kind: 'secret' },
  'webhook-config': mapping,
  'schedule-info': { kind: 'display' },
  'file-selector': selections,
  'sheet-selector': selections,
  'project-selector': selections,
  'channel-selector': selections,
  'user-selector': selections,
  'folder-selector': selections,
  'knowledge-base-selector': selections,
  'knowledge-tag-filters': structured((value) =>
    projectRows(value, [
      ['tagName', 'Tag'],
      ['fieldType', 'Type'],
      ['operator', 'Operator'],
      ['tagValue', 'Value'],
      ['valueTo', 'To'],
    ])
  ),
  'document-selector': selections,
  'document-tag-entry': structured((value) =>
    projectRows(value, [
      ['tagName', 'Tag'],
      ['fieldType', 'Type'],
      ['value', 'Value'],
    ])
  ),
  'mcp-server-selector': selections,
  'mcp-tool-selector': selections,
  'mcp-dynamic-args': mapping,
  'input-format': structured((value) =>
    projectRows(value, [
      ['name', 'Name'],
      ['type', 'Type'],
      ['value', 'Default value'],
      ['description', 'Description'],
    ])
  ),
  'response-format': structured((value) =>
    projectRows(value, [
      ['name', 'Name'],
      ['type', 'Type'],
      ['value', 'Value'],
      ['description', 'Description'],
    ])
  ),
  'filter-builder': structured((value) =>
    projectRows(value, [
      ['logicalOperator', 'Join'],
      ['column', 'Column'],
      ['operator', 'Operator'],
      ['value', 'Value'],
    ])
  ),
  'sort-builder': structured((value) =>
    projectRows(value, [
      ['column', 'Column'],
      ['direction', 'Direction'],
    ])
  ),
  'file-upload': structured(filePresentation),
  'input-mapping': mapping,
  'variables-input': structured((value) =>
    projectRows(value, [
      ['variableName', 'Variable'],
      ['type', 'Type'],
      ['value', 'Value'],
    ])
  ),
  'messages-input': structured((value) =>
    projectRows(value, [
      ['role', 'Role'],
      ['content', 'Content'],
    ])
  ),
  'workflow-selector': selections,
  'workflow-output-selector': selections,
  'workflow-input-mapper': mapping,
  text,
  'router-input': structured(branchPresentation),
  'table-selector': selections,
  'model-fallback-list': structured((value) =>
    projectRows(value, [
      ['model', 'Model'],
      ['apiKey', 'API key'],
      ['reasoningEffort', 'Reasoning effort'],
      ['thinkingLevel', 'Thinking level'],
      ['verbosity', 'Verbosity'],
    ])
  ),
  'column-selector': selections,
  modal: { kind: 'json' },
} satisfies Record<SubBlockType, PresentationDefinition>

export function getSubBlockPresentationKind(
  type: SubBlockType | undefined,
  oldValue?: unknown,
  newValue?: unknown
): SubBlockPresentationKind {
  if (!type || !Object.hasOwn(PRESENTATIONS, type)) return 'json'
  const kind = PRESENTATIONS[type].kind
  if (kind === 'selection') {
    return [oldValue, newValue].some((value) => value !== null && typeof value === 'object')
      ? 'structured'
      : 'scalar'
  }
  return kind
}

/** Readonly adapters preserve domain order and raw identity; rendering owns secret masking. */
export function getStructuredValuePresentation(
  config: SubBlockConfig | undefined,
  field: string,
  value: unknown,
  values: Record<string, unknown> = {}
): StructuredValuePresentation | null {
  if (!config || !Object.hasOwn(PRESENTATIONS, config.type)) return null
  const definition: PresentationDefinition = PRESENTATIONS[config.type]
  if (!definition.present) return null
  const shaped = shapeSubBlockValue(field, value, config.type)
  const decoded = decodeStructuredText(shaped)
  const presentation = definition.present(decoded.value, config, values)
  return {
    ...presentation,
    encoding: decoded.encoded ? 'json-text' : 'structured',
    sourceKey: normalizedStringify({ value: shaped }),
  }
}
