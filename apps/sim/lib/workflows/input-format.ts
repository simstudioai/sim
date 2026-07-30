import { generateId } from '@sim/utils/id'
import { isInternalFileUrl, parseInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import type { InputFormatField } from '@/lib/workflows/types'
import type { UserFile } from '@/executor/types'

/**
 * Simplified input field representation for workflow input mapping
 */
export interface WorkflowInputField {
  /**
   * Stable per-field id seeded at field creation (`InputFormatFieldState.id`).
   * Custom blocks anchor their input sub-block on this so renaming a field
   * never orphans a consumer's placed value. Absent on legacy fields.
   */
  id?: string
  name: string
  type: string
  description?: string
  /**
   * Consumer-facing placeholder hint for a custom block's curated input. Authored
   * in the Custom Blocks settings UI; has no source on the workflow's Start block.
   */
  placeholder?: string
  /**
   * Consumers must fill this custom-block input. Authored in the Custom Blocks
   * settings UI; has no source on the workflow's Start block.
   */
  required?: boolean
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
 * Whether an input-format field type denotes a file input. Matches the canonical
 * `file[]` written by the field-type dropdown — the same literal the execution
 * and webhook file paths already key off (`lib/execution/files.ts`,
 * `lib/webhooks/providers/generic.ts`) — so the editor and runtime agree and no
 * existing non-`file[]` field changes behavior.
 */
export function isFileFieldType(type: string | null | undefined): boolean {
  return type === 'file[]'
}

/**
 * Run-ready file object stored as a file field's value. Derived from the
 * executor's canonical {@link UserFile} (validated by `normalizeStartFile`) so
 * editor-attached files flow into a run unchanged and the shape can't drift.
 */
export type InputFormatFile = Pick<UserFile, 'id' | 'name' | 'url' | 'size' | 'type'> &
  Pick<Partial<UserFile>, 'key'>

/**
 * Whether a file's key is usable at run time: an explicit non-empty `key`, or an
 * internal `/api/files/serve/...` URL the key can actually be parsed from. This
 * mirrors `normalizeStartFile` exactly (including the parse, so a malformed
 * internal URL is rejected rather than accepted on the prefix alone).
 */
function hasRecoverableFileKey(file: InputFormatFile): boolean {
  if (typeof file.key === 'string' && file.key.length > 0) return true
  if (typeof file.url !== 'string' || !isInternalFileUrl(file.url)) return false
  try {
    return parseInternalFileUrl(file.url).key.length > 0
  } catch {
    return false
  }
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

  return raw.filter((file): file is InputFormatFile => {
    if (file === null || typeof file !== 'object') return false
    const f = file as InputFormatFile
    // Accept only the run-ready shape `normalizeStartFile` accepts (non-empty
    // id/name/url/type + finite size + recoverable key); file normalization is
    // all-or-nothing, so anything short of this falls back to the JSON editor
    // rather than silently dropping every file at run time.
    return (
      typeof f.id === 'string' &&
      f.id.length > 0 &&
      typeof f.name === 'string' &&
      f.name.length > 0 &&
      typeof f.url === 'string' &&
      f.url.length > 0 &&
      typeof f.size === 'number' &&
      Number.isFinite(f.size) &&
      typeof f.type === 'string' &&
      f.type.length > 0 &&
      hasRecoverableFileKey(f)
    )
  })
}

/**
 * Collects all editor-attached files from the file-typed fields of an
 * inputFormat value. Files are already uploaded (run-ready), so callers can pass
 * them straight to the executor's file channel without a re-upload.
 */
export function collectInputFormatFiles(inputFormatValue: unknown): InputFormatFile[] {
  if (!Array.isArray(inputFormatValue)) return []
  return inputFormatValue.flatMap((field) =>
    field &&
    typeof field === 'object' &&
    isFileFieldType((field as { type?: unknown }).type as string)
      ? parseInputFormatFiles((field as { value?: unknown }).value)
      : []
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
        (
          field: unknown
        ): field is { id?: unknown; name: string; type?: string; description?: string } =>
          typeof field === 'object' &&
          field !== null &&
          'name' in field &&
          typeof (field as { name: unknown }).name === 'string' &&
          (field as { name: string }).name.trim() !== ''
      )
      .map((field) => ({
        ...(typeof field.id === 'string' && field.id ? { id: field.id } : {}),
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
        (
          field: unknown
        ): field is { id?: unknown; name: string; type?: string; description?: string } =>
          typeof field === 'object' &&
          field !== null &&
          'name' in field &&
          typeof (field as { name: unknown }).name === 'string' &&
          (field as { name: string }).name.trim() !== ''
      )
      .map((field) => ({
        ...(typeof field.id === 'string' && field.id ? { id: field.id } : {}),
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
