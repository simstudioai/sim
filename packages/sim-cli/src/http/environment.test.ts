import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resetEnvironmentNotices,
  warnIfCredentialOverCleartext,
  warnIfProxyIgnored,
} from './environment'

let writes: string[]
let originalWrite: typeof process.stderr.write

beforeEach(() => {
  resetEnvironmentNotices()
  writes = []
  originalWrite = process.stderr.write
  process.stderr.write = ((chunk: string) => {
    writes.push(String(chunk))
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.stderr.write = originalWrite
})

describe('a proxy the request will not go through', () => {
  it('reports a proxy the runtime is capable of but was not opted into', () => {
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080' }, 'v22.21.0')
    expect(writes.join('')).toContain('NODE_USE_ENV_PROXY=1')
  })

  it('reports a runtime that cannot honour it at all, naming the version', () => {
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1' }, 'v22.19.0')
    expect(writes.join('')).toContain('Node v22.19.0 cannot use it')
  })
})

describe('an API key crossing the network in the clear', () => {
  it('reports a key sent to a remote host over http', () => {
    warnIfCredentialOverCleartext('http://sim.internal.example', true)
    expect(writes.join('')).toContain('sim.internal.example')
    expect(writes.join('')).toContain('over http')
  })
})
