import { generateId } from '@sim/utils/id'
import {
  type createDefaultInputFormatField,
  type InputFormatFile,
  parseInputFormatFiles,
} from '@/lib/workflows/input-format'

/** A Start or response field as the editor stores it: id, name, type, value, description, fold. */
export type InputFormatFieldState = ReturnType<typeof createDefaultInputFormatField>

/**
 * A file as the editor's file uploader holds it: keyed by `path`, where the stored run-ready file
 * keeps the same location as `url`.
 */
interface UploadedFileValue {
  name: string
  path: string
  key?: string
  size: number
  type: string
}

/** Maps stored run-ready file objects to the uploader's value shape. */
export function filesToControlValue(files: InputFormatFile[]): UploadedFileValue[] {
  return files.map((file) => ({
    name: file.name,
    path: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
  }))
}

/**
 * Maps the uploader's value back to stored run-ready file objects, keeping the stable `id` of
 * files that were already present.
 */
export function controlValueToFiles(
  value: UploadedFileValue | UploadedFileValue[] | null,
  previous: InputFormatFile[]
): InputFormatFile[] {
  const uploaded = Array.isArray(value) ? value : value ? [value] : []
  return uploaded.map((file) => {
    const existing = previous.find(
      (prev) => (file.key && prev.key === file.key) || prev.url === file.path
    )
    return {
      id: existing?.id ?? generateId(),
      name: file.name,
      url: file.path,
      key: file.key,
      size: file.size,
      type: file.type,
    }
  })
}

/** Serializes run-ready file objects into a field value string, empty when there are none. */
export function serializeInputFormatFiles(files: InputFormatFile[]): string {
  return files.length > 0 ? JSON.stringify(files, null, 2) : ''
}

/**
 * The editor a file field opens in: the uploader, unless the stored value is free-form content
 * (raw text, or an array with any entry that is not run-ready) only the JSON editor can hold
 * without dropping entries the next time the field saves.
 */
export function defaultFileFieldMode(value: string | undefined): 'upload' | 'json' {
  if (!value || !value.trim()) return 'upload'
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return 'json'
  }
  if (!Array.isArray(parsed)) return 'json'
  if (parsed.length === 0) return 'upload'
  return parseInputFormatFiles(parsed).length === parsed.length ? 'upload' : 'json'
}
