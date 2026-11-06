import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseOptions } from '@/lib/file-parsers/types'
import { isZipShaped } from '@/lib/file-parsers/zip-guard'

type ParseOfficeAsync = (input: Buffer) => Promise<string>

interface OfficeParserModule {
  parseOfficeAsync?: ParseOfficeAsync
  default?: { parseOfficeAsync?: ParseOfficeAsync } | ParseOfficeAsync
}

/**
 * Resolve the parser entry point across ESM and bundled CommonJS namespace
 * shapes, including the bundler shape where `module.exports` itself becomes
 * the function on `default` — a mismatch here has silently degraded every
 * `.pptx`/`.doc` parse in production before.
 */
export function resolveParseOfficeAsync(mod: OfficeParserModule): ParseOfficeAsync {
  if (typeof mod.parseOfficeAsync === 'function') return mod.parseOfficeAsync
  if (typeof mod.default === 'function') return mod.default
  if (typeof mod.default?.parseOfficeAsync === 'function') return mod.default.parseOfficeAsync

  throw new Error('officeparser did not expose parseOfficeAsync')
}

async function loadParseOfficeAsync(): Promise<ParseOfficeAsync> {
  try {
    return resolveParseOfficeAsync((await import('officeparser')) as OfficeParserModule)
  } catch (error) {
    throw new FileParserError(
      'runtime_failure',
      'The officeparser runtime could not be loaded',
      error
    )
  }
}

/**
 * Parse an Office archive as plain text after the caller enforces app-level archive limits.
 *
 * Only a ZIP container reaches officeparser. It sniffs a buffer's type with `file-type` 16,
 * whose ASF detector loops forever on a sub-header of size zero (GHSA-5v7r-6r5c-r473), so a
 * 55-byte upload named `.docx` would stall the event loop once mammoth or the ODF walker
 * rejected it. Every format routed here is a ZIP package, and a buffer that opens with a ZIP
 * signature can never match the ASF header.
 */
export async function parseOfficeText(
  input: Buffer,
  options: FileParseOptions = {}
): Promise<string> {
  options.signal?.throwIfAborted()
  if (!isZipShaped(input)) {
    throw new FileParserError('invalid_format', 'Not an Office (ZIP) package')
  }
  const parseOfficeAsync = await loadParseOfficeAsync()
  const result = await parseOfficeAsync(input)
  options.signal?.throwIfAborted()
  return result
}
