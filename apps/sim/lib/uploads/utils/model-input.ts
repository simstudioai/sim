import { isPlainRecord } from '@sim/utils/object'
import type { ResolvedSecretInputPath } from '@/executor/utils/resolved-secret-trace-registry'

interface ModelBoundFileInputOptions {
  includeInlineBase64?: boolean
  includeName?: boolean
  parseSerializedFile?: boolean
}

interface PreferredModelBoundFileInputPathOptions extends ModelBoundFileInputOptions {
  file: unknown
  filePath: unknown
  fileInputPath: ResolvedSecretInputPath
  filePathInputPath: ResolvedSecretInputPath
  prefer: 'file' | 'path'
}

function selectFileRecordInputPaths(
  input: Record<string, unknown>,
  rootPath: ResolvedSecretInputPath,
  options: ModelBoundFileInputOptions
): ResolvedSecretInputPath[] {
  const paths: ResolvedSecretInputPath[] = []
  let hasSource = false

  if (options.includeInlineBase64 && input.base64) {
    hasSource = true
    paths.push([...rootPath, 'base64'])
  } else if (input.key) {
    hasSource = true
  } else if (input.path) {
    hasSource = true
    paths.push([...rootPath, 'path'])
  } else if (input.url) {
    hasSource = true
    paths.push([...rootPath, 'url'])
  }

  if (hasSource && options.includeName && input.name !== undefined) {
    paths.push([...rootPath, 'name'])
  }
  return paths
}

/** Selects resolver input paths for only the source-bearing fields consumed by a model. */
export function selectModelBoundFileInputPaths(
  input: unknown,
  rootPath: ResolvedSecretInputPath,
  options: ModelBoundFileInputOptions = {}
): ResolvedSecretInputPath[] {
  if (Array.isArray(input)) {
    return input.flatMap((entry, index) =>
      selectModelBoundFileInputPaths(entry, [...rootPath, String(index)], options)
    )
  }
  if (typeof input === 'string') {
    if (options.parseSerializedFile) {
      try {
        const parsed = JSON.parse(input)
        if (isPlainRecord(parsed)) {
          return selectFileRecordInputPaths(parsed, rootPath, options).length > 0 ? [rootPath] : []
        }
      } catch {
        return [rootPath]
      }
    }
    return [rootPath]
  }
  if (!isPlainRecord(input)) return []
  return selectFileRecordInputPaths(input, rootPath, options)
}

function selectFilePath(input: unknown): string | undefined {
  if (typeof input !== 'string' || input === 'null' || input.trim() === '') return undefined
  return input.trim()
}

/** Mirrors file-vs-path precedence while selecting exact resolver input paths. */
export function selectPreferredModelBoundFileInputPaths(
  options: PreferredModelBoundFileInputPathOptions
): ResolvedSecretInputPath[] {
  const hasFile = isPlainRecord(options.file)
  const filePath = selectFilePath(options.filePath)

  if (options.prefer === 'file' && hasFile) {
    return selectModelBoundFileInputPaths(options.file, options.fileInputPath, options)
  }
  if (filePath !== undefined) return [options.filePathInputPath]
  if (options.prefer === 'path' && hasFile) {
    return selectModelBoundFileInputPaths(options.file, options.fileInputPath, options)
  }
  return []
}
