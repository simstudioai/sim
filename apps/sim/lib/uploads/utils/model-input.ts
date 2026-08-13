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
  const hasSource = Boolean(input.base64 || input.key || input.path || input.url)

  if (options.includeInlineBase64 && input.base64) {
    paths.push([...rootPath, 'base64'])
  }
  if (typeof input.path === 'string' && isInlineDataUrl(input.path)) {
    paths.push([...rootPath, 'path'])
  }
  if (typeof input.url === 'string' && isInlineDataUrl(input.url)) {
    paths.push([...rootPath, 'url'])
  }

  if (hasSource && options.includeName && input.name !== undefined) {
    paths.push([...rootPath, 'name'])
  }
  return paths
}

function isInlineDataUrl(value: string): boolean {
  return /^data:[^,]*;base64,/iu.test(value.trim())
}

/**
 * Selects inline file content and explicitly requested model-visible metadata. Storage keys,
 * paths, and remote URLs are locators: provenance on a locator says nothing about the fetched
 * bytes, which are authorized independently at the owning file boundary.
 */
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
        return selectModelBoundFileInputPaths(parsed, rootPath, {
          ...options,
          parseSerializedFile: false,
        }).length > 0
          ? [rootPath]
          : []
      } catch {
        return isInlineDataUrl(input) ? [rootPath] : []
      }
    }
    return isInlineDataUrl(input) ? [rootPath] : []
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
  if (filePath !== undefined) {
    return isInlineDataUrl(filePath) ? [options.filePathInputPath] : []
  }
  if (options.prefer === 'path' && hasFile) {
    return selectModelBoundFileInputPaths(options.file, options.fileInputPath, options)
  }
  return []
}

/** Selects only file names that are serialized into model-visible requests. */
export function selectModelVisibleFileNames(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(selectModelVisibleFileNames)
  if (!isPlainRecord(input)) return undefined
  return input.name !== undefined ? { name: input.name } : {}
}

function haveExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

/** Reapplies projected file names while preserving every locator and inline-content field. */
export function applyProjectedModelVisibleFileNames(
  original: unknown,
  projected: unknown
): unknown {
  if (Array.isArray(original)) {
    if (!Array.isArray(projected) || projected.length !== original.length) {
      throw new Error('Projected file names do not match the original files')
    }
    return original.map((entry, index) =>
      applyProjectedModelVisibleFileNames(entry, projected[index])
    )
  }

  if (!isPlainRecord(original)) {
    if (projected !== undefined) {
      throw new Error('Projected file name does not match the original file')
    }
    return original
  }
  if (!isPlainRecord(projected)) {
    throw new Error('Projected file name is invalid')
  }

  if (original.name === undefined) {
    if (!haveExactKeys(projected, [])) {
      throw new Error('Projected file name does not match the original file')
    }
    return { ...original }
  }
  if (!haveExactKeys(projected, ['name']) || typeof projected.name !== 'string') {
    throw new Error('Projected file name is invalid')
  }
  return { ...original, name: projected.name }
}
