import { generateId } from '@sim/utils/id'
import { type InputFormatFile, parseInputFormatFiles } from '@/lib/workflows/input-format'
import type { UploadedFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/file-upload/file-upload'

/**
 * Pure adapters bridging a file-typed input-format field's stored value (a JSON
 * string of run-ready {@link InputFormatFile} objects) and the {@link FileUpload}
 * component's value shape (which keys off `path`). Kept separate from the React
 * component so they can be unit-tested without a DOM.
 */

/**
 * Maps stored run-ready file objects to the {@link FileUpload} value shape.
 */
export function filesToControlValue(files: InputFormatFile[]): UploadedFile[] {
  return files.map((file) => ({
    name: file.name,
    path: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
  }))
}

/**
 * Maps a {@link FileUpload} value back to stored run-ready file objects,
 * preserving the stable `id` of files that were already present.
 */
export function controlValueToFiles(
  value: UploadedFile | UploadedFile[] | null,
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

/**
 * Serializes run-ready file objects into a field value string (empty when none).
 */
export function serializeInputFormatFiles(files: InputFormatFile[]): string {
  return files.length > 0 ? JSON.stringify(files, null, 2) : ''
}

/**
 * Default editor mode for a file field: the uploader, unless the stored value is
 * legacy free-form content (raw text or a non-file array) that only the JSON
 * editor can represent without data loss.
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
  return parsed.length === 0 || parseInputFormatFiles(parsed).length > 0 ? 'upload' : 'json'
}
