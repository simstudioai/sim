/**
 * Pure display helpers for collapsed subblock rows.
 *
 * Shared by the canvas editor (`workflow-block.tsx`, hook-fed data) and the
 * read-only preview (`preview-workflow/.../block.tsx`, prop/store-fed data).
 * Every resolver takes plain data instead of hooks so both surfaces run the
 * exact same logic and cannot drift.
 */
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import type { FilterRule, SortRule } from '@/lib/table/types'
import { DELETED_WORKFLOW_LABEL } from '@/app/workspace/[workspaceId]/logs/utils'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'

/**
 * Joins display names as "A", "A, B", or "A, B +N".
 * Returns null for an empty list so callers can fall through.
 */
export function summarizeNames(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]}, ${names[1]}`
  return `${names[0]}, ${names[1]} +${names.length - 2}`
}

interface WorkflowTableRow {
  id: string
  cells: Record<string, string>
}

interface FieldFormat {
  id: string
  name: string
  type?: string
  value?: string
  collapsed?: boolean
}

interface TagFilterItem {
  id: string
  tagName: string
  fieldType?: string
  operator?: string
  tagValue: string
}

interface DocumentTagItem {
  id: string
  tagName: string
  fieldType?: string
  value: string
}

const isTableRowArray = (value: unknown): value is WorkflowTableRow[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'id' in firstItem &&
    'cells' in firstItem &&
    typeof firstItem.cells === 'object'
  )
}

const isFieldFormatArray = (value: unknown): value is FieldFormat[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'id' in firstItem &&
    'name' in firstItem &&
    typeof firstItem.name === 'string'
  )
}

/** Type guard for variable assignments arrays (variables-input subblocks). */
const isVariableAssignmentsArray = (
  value: unknown
): value is Array<{ id?: string; variableId?: string; variableName?: string; value: unknown }> => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        ('variableName' in item || 'variableId' in item)
    )
  )
}

const isMessagesArray = (value: unknown): value is Array<{ role: string; content: string }> => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'role' in item &&
        'content' in item &&
        typeof item.role === 'string' &&
        typeof item.content === 'string'
    )
  )
}

const isTagFilterArray = (value: unknown): value is TagFilterItem[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'tagName' in firstItem &&
    'tagValue' in firstItem &&
    typeof firstItem.tagName === 'string'
  )
}

const isDocumentTagArray = (value: unknown): value is DocumentTagItem[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'tagName' in firstItem &&
    'value' in firstItem &&
    !('tagValue' in firstItem) &&
    typeof firstItem.tagName === 'string'
  )
}

const isFilterConditionArray = (value: unknown): value is FilterRule[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'column' in firstItem &&
    'operator' in firstItem &&
    'logicalOperator' in firstItem &&
    typeof firstItem.column === 'string'
  )
}

const isSortConditionArray = (value: unknown): value is SortRule[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstItem = value[0]
  return (
    typeof firstItem === 'object' &&
    firstItem !== null &&
    'column' in firstItem &&
    'direction' in firstItem &&
    typeof firstItem.column === 'string' &&
    (firstItem.direction === 'asc' || firstItem.direction === 'desc')
  )
}

/**
 * Attempts to parse a JSON string, returning the parsed value or the
 * original value if parsing fails.
 */
const tryParseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      return JSON.parse(trimmed)
    }
  } catch {
    return value
  }
  return value
}

/**
 * Formats a subblock value for display, intelligently handling nested
 * objects and arrays.
 */
export const getDisplayValue = (value: unknown): string => {
  if (value == null || value === '') return '-'

  const parsedValue = tryParseJson(value)

  if (isMessagesArray(parsedValue)) {
    const firstMessage = parsedValue[0]
    if (!firstMessage?.content || firstMessage.content.trim() === '') return '-'
    const content = firstMessage.content.trim()
    return truncate(content, 50)
  }

  if (isVariableAssignmentsArray(parsedValue)) {
    const names = parsedValue.map((a) => a.variableName).filter((name): name is string => !!name)
    return summarizeNames(names) ?? '-'
  }

  if (isTagFilterArray(parsedValue)) {
    const names = parsedValue
      .filter((f) => typeof f.tagName === 'string' && f.tagName.trim() !== '')
      .map((f) => f.tagName)
    return summarizeNames(names) ?? '-'
  }

  if (isDocumentTagArray(parsedValue)) {
    const names = parsedValue
      .filter((t) => typeof t.tagName === 'string' && t.tagName.trim() !== '')
      .map((t) => t.tagName)
    return summarizeNames(names) ?? '-'
  }

  if (isFilterConditionArray(parsedValue)) {
    const opLabels: Record<string, string> = {
      eq: '=',
      ne: '≠',
      gt: '>',
      gte: '≥',
      lt: '<',
      lte: '≤',
      contains: '~',
      in: 'in',
    }
    const names = parsedValue
      .filter((c) => typeof c.column === 'string' && c.column.trim() !== '')
      .map((c) => `${c.column} ${opLabels[c.operator] || c.operator} ${c.value || '?'}`)
    return summarizeNames(names) ?? '-'
  }

  if (isSortConditionArray(parsedValue)) {
    const names = parsedValue
      .filter((c) => typeof c.column === 'string' && c.column.trim() !== '')
      .map((c) => `${c.column} ${c.direction === 'desc' ? '↓' : '↑'}`)
    return summarizeNames(names) ?? '-'
  }

  if (isTableRowArray(parsedValue)) {
    const nonEmptyRows = parsedValue.filter((row) => {
      const cellValues = Object.values(row.cells)
      return cellValues.some((cell) => cell && cell.trim() !== '')
    })

    if (nonEmptyRows.length === 0) return '-'
    if (nonEmptyRows.length === 1) {
      const firstRow = nonEmptyRows[0]
      const cellEntries = Object.entries(firstRow.cells).filter(([, val]) => val?.trim())
      if (cellEntries.length === 0) return '-'
      const preview = cellEntries
        .slice(0, 2)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ')
      return cellEntries.length > 2 ? `${preview}...` : preview
    }
    return `${nonEmptyRows.length} rows`
  }

  if (isFieldFormatArray(parsedValue)) {
    const names = parsedValue
      .filter((field) => typeof field.name === 'string' && field.name.trim() !== '')
      .map((field) => field.name)
    return summarizeNames(names) ?? '-'
  }

  if (isRecordLike(parsedValue)) {
    const entries = Object.entries(parsedValue).filter(
      ([, val]) => val !== null && val !== undefined && val !== ''
    )

    if (entries.length === 0) return '-'
    if (entries.length === 1) {
      const [key, val] = entries[0]
      const valStr = String(val).slice(0, 30)
      return `${key}: ${valStr}${String(val).length > 30 ? '...' : ''}`
    }
    const preview = entries
      .slice(0, 2)
      .map(([key]) => key)
      .join(', ')
    return entries.length > 2 ? `${preview} +${entries.length - 2}` : preview
  }

  if (Array.isArray(parsedValue)) {
    const getItemDisplayValue = (item: unknown): string => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        return String(obj.title || obj.name || obj.label || obj.id || JSON.stringify(item))
      }
      return String(item)
    }
    const names = parsedValue
      .filter((item) => item !== null && item !== undefined && item !== '')
      .map(getItemDisplayValue)
    return summarizeNames(names) ?? '-'
  }

  const stringValue = String(value)
  if (stringValue === '[object Object]') {
    try {
      const json = JSON.stringify(parsedValue)
      if (json.length <= 40) return json
      return truncate(json, 37)
    } catch {
      return '-'
    }
  }

  return stringValue.trim().length > 0 ? stringValue : '-'
}

/**
 * Workflow id -> metadata lookup for the workflow selector resolvers.
 * `ready` gates resolution so missing entries only render as deleted once
 * the lookup has actually loaded.
 */
interface WorkflowNameLookup {
  workflowMap: Record<string, { name: string }>
  ready: boolean
}

/**
 * Resolves filter/sort builder subblocks to a compact single-line JSON
 * preview. Returns null for other subblocks; callers use a non-null result
 * to apply monospace styling.
 */
export function resolveFilterFieldLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown
): string | null {
  const isFilterField =
    subBlock?.id === 'filter' || subBlock?.id === 'filterCriteria' || subBlock?.id === 'sort'
  if (!isFilterField || !rawValue) return null

  const parsedValue = tryParseJson(rawValue)
  if (!isRecordLike(parsedValue) && !Array.isArray(parsedValue)) return null

  try {
    const jsonStr = JSON.stringify(parsedValue, null, 0)
    return jsonStr.length <= 35 ? jsonStr : truncate(jsonStr, 32)
  } catch {
    return null
  }
}

/**
 * Resolves a static dropdown/combobox value to its option label.
 * Returns null if not a dropdown/combobox or no matching option is found.
 */
export function resolveDropdownLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown
): string | null {
  if (!subBlock || (subBlock.type !== 'dropdown' && subBlock.type !== 'combobox')) return null
  if (!rawValue || typeof rawValue !== 'string') return null

  const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
  if (!options) return null

  const option = options.find((opt) =>
    typeof opt === 'string' ? opt === rawValue : opt.id === rawValue
  )

  if (!option) return null
  return typeof option === 'string' ? option : option.label
}

/** Resolves a workflow-selector value to the workflow's name. */
export function resolveWorkflowSelectionLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  lookup: WorkflowNameLookup
): string | null {
  if (subBlock?.type !== 'workflow-selector') return null
  if (!rawValue || typeof rawValue !== 'string') return null
  if (!lookup.ready) return null

  return lookup.workflowMap[rawValue]?.name ?? DELETED_WORKFLOW_LABEL
}

/**
 * Resolves multi-select workflow dropdowns (e.g. the Sim trigger's workflow
 * scope) to a workflow-name summary.
 */
export function resolveWorkflowMultiSelectLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  lookup: WorkflowNameLookup
): string | null {
  const isWorkflowMultiSelect =
    subBlock?.type === 'dropdown' &&
    subBlock.multiSelect &&
    (subBlock.id === 'workflowIds' || subBlock.canonicalParamId === 'workflowIds')
  if (!isWorkflowMultiSelect) return null
  if (!Array.isArray(rawValue) || rawValue.length === 0) return null
  if (!lookup.ready) return null

  const names = rawValue
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => lookup.workflowMap[id]?.name ?? DELETED_WORKFLOW_LABEL)

  return summarizeNames(names)
}

/** Resolves a variables-input value to a variable-name summary. */
export function resolveVariablesLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  variables: Array<{ id: string; name: string }>
): string | null {
  if (subBlock?.type !== 'variables-input') return null
  if (!isVariableAssignmentsArray(rawValue)) return null

  const names = rawValue
    .map((assignment) => {
      if (assignment.variableId) {
        return variables.find((variable) => variable.id === assignment.variableId)?.name
      }
      if (assignment.variableName) return assignment.variableName
      return null
    })
    .filter((name): name is string => !!name)

  return summarizeNames(names)
}

/**
 * Resolves a tool-input value to a tool-name summary. Names come from static
 * sources first (block registry, custom-tool records) so that edits to the
 * stored entry's `title` cannot change what the UI shows; the stored title
 * and inline schema names are only fallbacks for shapes with no canonical
 * source (MCP snapshots, legacy entries).
 */
export function resolveToolsLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  customTools: Array<{ id: string; title?: string; schema?: { function?: { name?: string } } }>
): string | null {
  if (subBlock?.type !== 'tool-input') return null
  if (!Array.isArray(rawValue) || rawValue.length === 0) return null

  const names = rawValue
    .map((tool: unknown) => {
      if (!tool || typeof tool !== 'object') return null
      const t = tool as Record<string, unknown>

      if (
        typeof t.type === 'string' &&
        t.type !== 'custom-tool' &&
        t.type !== 'mcp' &&
        t.type !== 'workflow' &&
        t.type !== 'workflow_input'
      ) {
        const blockConfig = getBlock(t.type)
        if (blockConfig?.name) return blockConfig.name
        return t.type
      }

      if (t.type === 'workflow' || t.type === 'workflow_input') return 'Workflow'

      if (t.type === 'custom-tool' && typeof t.customToolId === 'string') {
        const customTool = customTools.find((candidate) => candidate.id === t.customToolId)
        if (customTool?.title) return customTool.title
        if (customTool?.schema?.function?.name) return customTool.schema.function.name
      }

      if (typeof t.title === 'string' && t.title) return t.title

      const schema = t.schema as { function?: { name?: string } } | undefined
      if (schema?.function?.name) return schema.function.name

      const fn = t.function as { name?: string } | undefined
      if (fn?.name) return fn.name

      return null
    })
    .filter((name): name is string => !!name)

  return summarizeNames(names)
}

/**
 * Resolves a skill-input value to a skill-name summary: the live skill name
 * when the skill still exists, otherwise the name stored alongside the
 * reference. Unresolvable entries are skipped rather than shown as raw ids.
 */
export function resolveSkillsLabel(
  subBlock: SubBlockConfig | undefined,
  rawValue: unknown,
  skills: Array<{ id: string; name: string }>
): string | null {
  if (subBlock?.type !== 'skill-input') return null
  if (!Array.isArray(rawValue) || rawValue.length === 0) return null

  const names = rawValue
    .map((skill: unknown) => {
      if (!skill || typeof skill !== 'object') return null
      const s = skill as { skillId?: string; name?: string }

      if (s.skillId) {
        const found = skills.find((candidate) => candidate.id === s.skillId)
        if (found?.name) return found.name
      }
      if (typeof s.name === 'string' && s.name) return s.name

      return null
    })
    .filter((name): name is string => !!name)

  return summarizeNames(names)
}
