/**
 * Exercises the **real** parser registry — no mocks. `index.test.ts` stubs the
 * `@/lib/file-parsers` module itself, so it validates its own fake routing table
 * rather than the registry; nothing covered the real one.
 *
 * That gap is how a latent failure survived: the registry used to load each parser
 * with `require()` inside a `try/catch` that only logged, so wherever those calls
 * failed the registry came back **empty** and every format reported
 * `Unsupported file type` — with an empty "Supported types are:" list as the only
 * clue. Static imports plus this file make that state impossible to reach quietly.
 */
import { describe, expect, it } from 'vitest'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import type { SupportedFileType } from '@/lib/file-parsers/types'

/**
 * Every member of the public union. Adding a type without registering a parser
 * fails here instead of at runtime.
 */
const _ALL_SUPPORTED_TYPES: SupportedFileType[] = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'docm',
  'dotx',
  'txt',
  'md',
  'xlsx',
  'xls',
  'xlsm',
  'xlsb',
  'xltx',
  'html',
  'htm',
  'pptx',
  'pptm',
  'potx',
  'odt',
  'ods',
  'odp',
]

describe('file parser registry', () => {
  it('resolves extensions case-insensitively', () => {
    expect(isSupportedFileType('DOCX')).toBe(true)
    expect(isSupportedFileType('OdT')).toBe(true)
  })

  /**
   * Formats with no bundled extractor must not claim support. `rtf` especially:
   * `DocParser`'s plaintext branch would pass its control words through as prose.
   * Legacy `ppt` was registered once and only ever produced scraped placeholder
   * prose, so it is refused up front with the unsupported-type message instead.
   */
  it('does not claim formats with no extractor', () => {
    for (const extension of ['rtf', 'msg', 'eml', 'pages', 'key', 'one', 'vsdx', 'png', 'ppt']) {
      expect(isSupportedFileType(extension), `unexpectedly claims .${extension}`).toBe(false)
    }
  })

  /**
   * The extension is caller-supplied and reaches the registry as a lookup key. A
   * plain object would resolve inherited keys, so `PARSERS['constructor']` handed
   * back `Object` — truthy, with no parse methods — and routing fell through to
   * "does not support buffer parsing" (or a `TypeError` in `parseFile`) instead of
   * rejecting the extension. A `Map` has no prototype chain to walk.
   */
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'treats the inherited key %s as an unsupported extension',
    async (extension) => {
      expect(isSupportedFileType(extension)).toBe(false)
      await expect(parseBuffer(Buffer.from('x'), extension)).rejects.toThrow(
        /Unsupported file type/
      )
    }
  )

  it('reports a non-string extension as unsupported rather than throwing', () => {
    expect(isSupportedFileType(undefined as unknown as string)).toBe(false)
    expect(isSupportedFileType(null as unknown as string)).toBe(false)
  })

  it('rejects an empty buffer before routing', async () => {
    await expect(parseBuffer(Buffer.alloc(0), 'docx')).rejects.toThrow('Empty buffer provided')
  })
})
