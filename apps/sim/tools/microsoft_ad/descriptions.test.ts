/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TOOL_DIR = join(import.meta.dirname, '.')

/**
 * A backslash-escaped single quote that is not itself escaped. The docs generator parses these
 * files as *source* rather than importing them, so `department eq \'Sales\'` reaches the
 * published MDX with its backslashes intact and, in a table cell, truncates the row.
 * The lookbehind spares the regex-escape idiom `replace(/\\/g, '\\\\')`, where the quote is
 * preceded by a genuine escaped backslash.
 */
const ESCAPED_SINGLE_QUOTE = /(?<!\\)\\'/

describe('microsoft_ad tool sources', () => {
  const files = readdirSync(TOOL_DIR).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
  )

  it('covers every tool file', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it.each(files)('%s escapes no single quotes', (file) => {
    const offenders = readFileSync(join(TOOL_DIR, file), 'utf8')
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => ESCAPED_SINGLE_QUOTE.test(line))

    expect(offenders).toEqual([])
  })
})
