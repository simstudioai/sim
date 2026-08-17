/**
 * @vitest-environment node
 *
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
const ALL_SUPPORTED_TYPES: SupportedFileType[] = [
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
  'ppt',
  'pptm',
  'potx',
  'odt',
  'ods',
  'odp',
]

describe('file parser registry', () => {
  it('registers a parser for every SupportedFileType', () => {
    for (const extension of ALL_SUPPORTED_TYPES) {
      expect(isSupportedFileType(extension), `no parser registered for .${extension}`).toBe(true)
    }
  })

  it('registers buffer parsing for every SupportedFileType', async () => {
    for (const extension of ALL_SUPPORTED_TYPES) {
      /**
       * Fed a deliberately invalid document, so each parser is free to throw a
       * parse error or return empty content — both mean routing found a parser.
       * The only unacceptable outcome is a *routing* failure, which is what the
       * two messages below report. Real extraction lives in `parser-formats.test.ts`.
       */
      const outcome = await parseBuffer(Buffer.from('not a real document'), extension).catch(
        (error: Error) => error
      )

      if (outcome instanceof Error) {
        expect(outcome.message, `.${extension} routing`).not.toMatch(
          /does not support buffer parsing|Unsupported file type/
        )
      } else {
        expect(outcome, `.${extension} result`).toHaveProperty('content')
      }
    }
  })

  it('resolves extensions case-insensitively', () => {
    expect(isSupportedFileType('DOCX')).toBe(true)
    expect(isSupportedFileType('OdT')).toBe(true)
  })

  /**
   * Formats with no bundled extractor must not claim support. `rtf` especially:
   * `DocParser`'s plaintext branch would pass its control words through as prose.
   */
  it('does not claim formats with no extractor', () => {
    for (const extension of ['rtf', 'msg', 'eml', 'pages', 'key', 'one', 'vsdx', 'png']) {
      expect(isSupportedFileType(extension), `unexpectedly claims .${extension}`).toBe(false)
    }
  })

  it('names the registered types when rejecting an unknown extension', async () => {
    await expect(parseBuffer(Buffer.from('x'), 'rtf')).rejects.toThrow(/Supported types are: .+/)
  })

  it('rejects an empty buffer before routing', async () => {
    await expect(parseBuffer(Buffer.alloc(0), 'docx')).rejects.toThrow('Empty buffer provided')
  })

  it('rejects a missing extension', async () => {
    await expect(parseBuffer(Buffer.from('x'), '')).rejects.toThrow('No file extension provided')
  })
})
