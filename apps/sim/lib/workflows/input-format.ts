import { generateId } from '@sim/utils/id'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'

/**
 * Simplified input field representation for workflow input mapping
 */
export interface WorkflowInputField {
  name: string
  type: string
  description?: string
}

/**
 * Stateful input-format field as stored in sub-block values: the editor's
 * per-row shape, including the editor-only `id` and `collapsed` fields. Stricter
 * than the wire-level {@link InputFormatField} (required `name`/`type`/`value`).
 */
interface InputFormatFieldState {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file[]'
  value: string
  description?: string
  collapsed: boolean
}

/**
 * Creates a new empty input-format field with a fresh id.
 *
 * Single source of truth for the default field shape used when seeding
 * input-format / response-format sub-blocks and when adding rows in the editor.
 */
export function createDefaultInputFormatField(): InputFormatFieldState {
  return {
    id: generateId(),
    name: '',
    type: 'string',
    value: '',
    collapsed: false,
  }
}

/**
 * Field type strings that denote a file input. The editor writes the canonical
 * `file[]`, but workflows authored via copilot or the API persist variants
 * (`files`, `file`, `image`); treat them all as file fields so the uploader and
 * runtime behave consistently.
 */
const FILE_FIELD_TYPES = new Set(['file[]', 'files', 'file', 'image'])

/**
 * Whether an input-format field type denotes a file input.
 */
export function isFileFieldType(type: string | null | undefined): boolean {
  return typeof type === 'string' && FILE_FIELD_TYPES.has(type.trim().toLowerCase())
}

/**
 * Run-ready file object stored as a file field's value. Mirrors the executor's
 * `UserFile` requirements (`normalizeStartFile`): an internal `url`/`key` plus a
 * stable `id`, so editor-attached files flow into a run unchanged.
 */
export interface InputFormatFile {
  id: string
  name: string
  url: string
  key?: string
  size: number
  type: string
}

/**
 * Tolerantly parses a file field's stored value (a JSON string, or an already
 * materialized array) into run-ready file objects. Returns an empty array for
 * legacy free-form values (base64 placeholders, raw text) that don't describe
 * uploaded files, so callers degrade gracefully instead of throwing.
 */
export function parseInputFormatFiles(value: unknown): InputFormatFile[] {
  let raw: unknown = value
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      raw = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  if (!Array.isArray(raw)) return []

  return raw.filter(
    (file): file is InputFormatFile =>
      file !== null &&
      typeof file === 'object' &&
      typeof (file as InputFormatFile).name === 'string' &&
      typeof (file as InputFormatFile).url === 'string' &&
      typeof (file as InputFormatFile).id === 'string'
  )
}

/**
 * Extracts input fields from workflow blocks.
 * Finds the trigger block (start_trigger, input_trigger, or starter) and extracts its inputFormat.
 *
 * @param blocks - The blocks object from workflow state
 * @returns Array of input field definitions
 */
export function extractInputFieldsFromBlocks(
  blocks: Record<string, unknown> | null | undefined
): WorkflowInputField[] {
  if (!blocks) return []

  // Find trigger block
  const triggerEntry = Object.entries(blocks).find(([, block]) => {
    const b = block as Record<string, unknown>
    return typeof b.type === 'string' && isInputDefinitionTrigger(b.type)
  })

  if (!triggerEntry) return []

  const triggerBlock = triggerEntry[1] as Record<string, unknown>
  const subBlocks = triggerBlock.subBlocks as Record<string, { value?: unknown }> | undefined
  const inputFormat = subBlocks?.inputFormat?.value

  // Try primary location: subBlocks.inputFormat.value
  if (Array.isArray(inputFormat)) {
    return inputFormat
      .filter(
        (field: unknown): field is { name: string; type?: string; description?: string } =>
          typeof field === 'object' &&
          field !== null &&
          'name' in field &&
          typeof (field as { name: unknown }).name === 'string' &&
          (field as { name: string }).name.trim() !== ''
      )
      .map((field) => ({
        name: field.name,
        type: field.type || 'string',
        ...(field.description && { description: field.description }),
      }))
  }

  // Try legacy location: config.params.inputFormat
  const config = triggerBlock.config as { params?: { inputFormat?: unknown } } | undefined
  const legacyFormat = config?.params?.inputFormat

  if (Array.isArray(legacyFormat)) {
    return legacyFormat
      .filter(
        (field: unknown): field is { name: string; type?: string; description?: string } =>
          typeof field === 'object' &&
          field !== null &&
          'name' in field &&
          typeof (field as { name: unknown }).name === 'string' &&
          (field as { name: string }).name.trim() !== ''
      )
      .map((field) => ({
        name: field.name,
        type: field.type || 'string',
        ...(field.description && { description: field.description }),
      }))
  }

  return []
}

/**
 * Normalizes an input format value into a list of valid fields.
 *
 * Filters out:
 * - null or undefined values
 * - Empty arrays
 * - Non-array values
 * - Fields without names
 * - Fields with empty or whitespace-only names
 *
 * @param inputFormatValue - Raw input format value from subblock state
 * @returns Array of validated input format fields
 */
export function normalizeInputFormatValue(inputFormatValue: unknown): InputFormatField[] {
  // Handle null, undefined, and empty arrays
  if (
    inputFormatValue === null ||
    inputFormatValue === undefined ||
    (Array.isArray(inputFormatValue) && inputFormatValue.length === 0)
  ) {
    return []
  }

  // Handle non-array values
  if (!Array.isArray(inputFormatValue)) {
    return []
  }

  // Filter valid fields
  return inputFormatValue.filter(
    (field): field is InputFormatField =>
      field &&
      typeof field === 'object' &&
      typeof field.name === 'string' &&
      field.name.trim() !== ''
  )
}
