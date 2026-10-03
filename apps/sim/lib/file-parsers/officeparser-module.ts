import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseOptions } from '@/lib/file-parsers/types'

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

/** Parse an Office archive as plain text after the caller enforces app-level archive limits. */
export async function parseOfficeText(
  input: Buffer,
  options: FileParseOptions = {}
): Promise<string> {
  options.signal?.throwIfAborted()
  const parseOfficeAsync = await loadParseOfficeAsync()
  const result = await parseOfficeAsync(input)
  options.signal?.throwIfAborted()
  return result
}
