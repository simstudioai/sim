import { describe, expect, it } from 'vitest'
import { mayLoadTransport } from './check-egress-boundary'

describe('egress transport candidate scan', () => {
  it('finds literal transport modules', () => {
    expect(mayLoadTransport("import { request } from 'node:https'")).toBe(true)
  })

  it('decodes escaped transport module literals', () => {
    expect(mayLoadTransport(String.raw`const http = require('node:\x68ttp')`)).toBe(true)
  })

  it('ignores transport names outside string tokens', () => {
    expect(mayLoadTransport('const https = createClient()')).toBe(false)
  })
})
