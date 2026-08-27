import { FileParserError } from '@/lib/file-parsers/errors'

/** `officeparser`'s single entry point, as every parser here calls it. */
type ParseOfficeAsync = (input: Buffer) => Promise<string>

interface OfficeParserModule {
  parseOfficeAsync?: ParseOfficeAsync
  default?: { parseOfficeAsync?: ParseOfficeAsync } | ParseOfficeAsync
}

/**
 * Resolves `officeparser`'s entry point across module systems.
 *
 * `officeparser` is CommonJS — `main: officeParser.js`, no `type` and no
 * `exports` map — so what `await import('officeparser')` yields depends on who
 * built the code. Node and webpack synthesize named exports from the CJS
 * `module.exports`, so `.parseOfficeAsync` is there. esbuild, which builds the
 * Trigger.dev worker bundle, puts `module.exports` on `.default` and leaves the
 * named export undefined.
 *
 * Reading the named export directly therefore worked everywhere except the
 * worker, where `parseOfficeAsync` was `undefined` and calling it threw
 * `TypeError: parseOfficeAsync is not a function`. Every parser here treats that
 * as "the library failed" and falls back to scraping the archive, which returns
 * `degraded: true` — and the document pipeline rejects a degraded parse outright.
 * The visible result was every `.pptx` and legacy `.doc` from a connector
 * failing as "No text could be extracted", while the same files parsed fine
 * through the app.
 *
 * Reading both shapes fixes it at the source rather than per bundler: the
 * alternative is externalizing the package in each build config, which has to be
 * repeated for every bundler this code runs under and silently regresses the day
 * one is missed.
 */
export function resolveParseOfficeAsync(mod: OfficeParserModule): ParseOfficeAsync {
  if (typeof mod.parseOfficeAsync === 'function') return mod.parseOfficeAsync
  if (typeof mod.default === 'function') return mod.default
  if (typeof mod.default?.parseOfficeAsync === 'function') return mod.default.parseOfficeAsync

  throw new Error('officeparser did not expose parseOfficeAsync')
}

/**
 * Split from {@link resolveParseOfficeAsync} so the shape handling is testable.
 * The failing shape cannot be reproduced by mocking the specifier — Vitest's
 * module-namespace proxy throws on a missing export rather than yielding the
 * `undefined` the real bundle produces — so a test that goes through `import`
 * can only assert the shape that already worked.
 */
export async function loadParseOfficeAsync(): Promise<ParseOfficeAsync> {
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
