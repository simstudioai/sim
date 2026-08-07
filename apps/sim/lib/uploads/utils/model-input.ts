import { isPlainRecord } from '@sim/utils/object'

interface ModelBoundFileInputOptions {
  includeInlineBase64?: boolean
  includeName?: boolean
  parseSerializedFile?: boolean
}

interface PreferredModelBoundFileInputOptions extends ModelBoundFileInputOptions {
  file: unknown
  filePath: unknown
  prefer: 'file' | 'path'
}

function selectFileRecord(
  input: Record<string, unknown>,
  options: ModelBoundFileInputOptions
): Record<string, unknown> | undefined {
  const selected: Record<string, unknown> = {}
  let hasSource = false

  if (options.includeInlineBase64 && input.base64) {
    hasSource = true
    selected.base64 = input.base64
  } else if (input.key) {
    hasSource = true
  } else if (input.path) {
    hasSource = true
    selected.path = input.path
  } else if (input.url) {
    hasSource = true
    selected.url = input.url
  }

  if (!hasSource) return undefined
  if (options.includeName && input.name !== undefined) selected.name = input.name
  return Object.keys(selected).length > 0 ? selected : undefined
}

/** Selects only the source-bearing fields that can contribute to one opaque model input. */
export function selectModelBoundFileInput(
  input: unknown,
  options: ModelBoundFileInputOptions = {}
): unknown {
  if (Array.isArray(input)) {
    return input
      .map((entry) => selectModelBoundFileInput(entry, options))
      .filter((entry) => entry !== undefined)
  }
  if (typeof input === 'string') {
    if (options.parseSerializedFile) {
      try {
        const parsed = JSON.parse(input)
        if (isPlainRecord(parsed)) return selectFileRecord(parsed, options)
      } catch {
        return input
      }
    }
    return input
  }
  if (!isPlainRecord(input)) return undefined
  return selectFileRecord(input, options)
}

function selectFilePath(input: unknown): string | undefined {
  if (typeof input !== 'string' || input === 'null' || input.trim() === '') return undefined
  return input.trim()
}

/** Mirrors a request body's file-vs-path precedence without selecting the unused alternative. */
export function selectPreferredModelBoundFileInput(
  options: PreferredModelBoundFileInputOptions
): unknown {
  const hasFile = isPlainRecord(options.file)
  const filePath = selectFilePath(options.filePath)

  if (options.prefer === 'file' && hasFile) {
    return selectModelBoundFileInput(options.file, options)
  }
  if (filePath !== undefined) return filePath
  if (options.prefer === 'path' && hasFile) {
    return selectModelBoundFileInput(options.file, options)
  }
  return undefined
}
