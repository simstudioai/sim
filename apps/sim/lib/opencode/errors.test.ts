/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { getOpenCodeRouteError } from '@/lib/opencode/errors'

describe('getOpenCodeRouteError', () => {
  it('does not leak the internal OpenCode base URL in connectivity errors', () => {
    const error = getOpenCodeRouteError(
      new Error('fetch failed for http://opencode:4096/session'),
      'repositories'
    )

    expect(error).toEqual({
      status: 503,
      message:
        'OpenCode server is unreachable. Check OPENCODE_BASE_URL and the runtime network configuration.',
    })
    expect(error.message).not.toContain('http://opencode:4096')
  })

  it('prioritizes connectivity errors over auth substring matches', () => {
    const error = getOpenCodeRouteError(
      new Error('fetch failed for http://127.0.0.1:4013/session'),
      'repositories'
    )

    expect(error).toEqual({
      status: 503,
      message:
        'OpenCode server is unreachable. Check OPENCODE_BASE_URL and the runtime network configuration.',
    })
  })
})
