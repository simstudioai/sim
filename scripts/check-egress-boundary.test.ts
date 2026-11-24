import { describe, expect, it } from 'vitest'
import { findForbiddenLoads, mayLoadForbiddenModule } from './check-egress-boundary'

describe('egress transport candidate scan', () => {
  it('finds literal transport modules', () => {
    expect(mayLoadForbiddenModule("import { request } from 'node:https'")).toBe(true)
  })

  it('decodes escaped transport module literals', () => {
    expect(mayLoadForbiddenModule(String.raw`const http = require('node:\x68ttp')`)).toBe(true)
  })

  it('ignores transport names outside string tokens', () => {
    expect(mayLoadForbiddenModule('const https = createClient()')).toBe(false)
  })

  it('flags production code that loads a test fixture, which the scan skips', () => {
    const source = "import { startFixture } from '@/lib/core/network/gateway-tls.test-helpers'"
    expect(mayLoadForbiddenModule(source)).toBe(true)
    expect(findForbiddenLoads('lib/x.ts', source)).toEqual([
      {
        line: 1,
        kind: 'import',
        specifier: '@/lib/core/network/gateway-tls.test-helpers',
      },
    ])
  })
})
