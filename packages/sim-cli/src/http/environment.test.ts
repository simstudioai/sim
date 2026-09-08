/**
 * @vitest-environment node
 */
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

  it('does not credit a Node line that never got the backport', () => {
    // 23.x sits between two supported lines but reached end of life before the
    // backport, so treating it as "between" silenced the warning on the very
    // line that still needs it.
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1' }, 'v23.11.0')
    expect(writes.join('')).toContain('Node v23.11.0 cannot use it')
  })

  it('does not credit a line before its own first supported release', () => {
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1' }, 'v24.0.0')
    expect(writes.join('')).toContain('Node v24.0.0 cannot use it')
  })

  it('credits every line after the first that shipped it', () => {
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1' }, 'v25.1.0')
    expect(writes).toEqual([])
  })

  it('stays silent once the runtime supports it and the caller opted in', () => {
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1' }, 'v24.5.0')
    warnIfProxyIgnored({ HTTP_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1' }, 'v22.21.0')
    expect(writes).toEqual([])
  })

  it('stays silent when no proxy is configured', () => {
    warnIfProxyIgnored({}, 'v22.19.0')
    expect(writes).toEqual([])
  })

  it('says it once, not once per request', () => {
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080' }, 'v24.5.0')
    warnIfProxyIgnored({ HTTPS_PROXY: 'http://proxy:8080' }, 'v24.5.0')
    expect(writes).toHaveLength(1)
  })
})

describe('an API key crossing the network in the clear', () => {
  it('reports a key sent to a remote host over http', () => {
    warnIfCredentialOverCleartext('http://sim.internal.example', true)
    expect(writes.join('')).toContain('sim.internal.example')
    expect(writes.join('')).toContain('over http')
  })

  it('stays silent for the documented local development case', () => {
    // `http://localhost:3000` is what the README and the login example use.
    for (const host of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://api.localhost']) {
      warnIfCredentialOverCleartext(host, true)
    }
    expect(writes).toEqual([])
  })

  it('stays silent over https, and when there is no key to leak', () => {
    warnIfCredentialOverCleartext('https://sim.example', true)
    warnIfCredentialOverCleartext('http://sim.internal.example', false)
    expect(writes).toEqual([])
  })
})
