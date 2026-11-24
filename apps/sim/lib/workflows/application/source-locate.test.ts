/**
 * @vitest-environment node
 */
import { encodeAnchor } from '@sim/workflow-code'
import { describe, expect, it } from 'vitest'
import { createLocator } from '@/lib/workflows/application/source-locate'

const SECRET = ['sk', '-', 'Qw8'.repeat(16)].join('')
const FILE = 'workflow.ts'
const TEXT = `const a = api('A', {\n  apiKey: '${SECRET}',\n})\n`
const SPANS = {
  [encodeAnchor({ kind: 'param', block: 'a', param: 'apiKey' })]: {
    file: FILE,
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 10 + SECRET.length,
    start: 23,
    end: 31 + SECRET.length,
  },
}

describe('createLocator', () => {
  it('places a literal-secret finding on its param without a frame that echoes the secret', () => {
    const locate = createLocator({ [FILE]: TEXT }, SPANS, new Map([['a', 'block-a']]))
    const secret = locate({
      code: 'W_LITERAL_SECRET',
      severity: 'warning',
      message: 'apiKey holds a literal secret.',
      blockKey: 'a',
      param: 'apiKey',
    })
    expect(secret).toMatchObject({ file: FILE, line: 2, blockId: 'block-a' })
    expect(JSON.stringify(secret)).not.toContain(SECRET)

    const other = locate({
      code: 'W_VALUE_KIND',
      severity: 'warning',
      message: 'apiKey expects a string value.',
      blockKey: 'a',
      param: 'apiKey',
    })
    expect(other.frame).toContain('apiKey')
  })
})
