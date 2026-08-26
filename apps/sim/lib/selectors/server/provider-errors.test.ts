/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  resolveSelectorProviderValue,
  selectorProviderFailure,
} from '@/lib/selectors/server/provider-errors'

describe('selectorProviderFailure', () => {
  it.each([
    [
      401,
      {
        error: 'Atlassian rejected this credential. Reconnect it and try again.',
        status: 401,
        authRequired: true,
      },
    ],
    [403, { error: 'Atlassian denied selector access.', status: 403 }],
    [
      429,
      {
        error: 'Atlassian rate-limited selector discovery. Try again shortly.',
        status: 429,
      },
    ],
    [400, { error: 'Atlassian selector discovery failed.', status: 502 }],
    [500, { error: 'Atlassian selector discovery failed.', status: 502 }],
  ])('maps provider status %s to its stable public failure', (input, expected) => {
    expect(selectorProviderFailure('Atlassian', input)).toEqual(expected)
  })

  it('sanitizes a provider discovery exception without serializing its body marker', async () => {
    const providerError = Object.assign(new Error('provider-body-secret-marker'), { status: 429 })

    const result = await resolveSelectorProviderValue('Jira', async () => {
      throw providerError
    })

    expect(result).toEqual({
      ok: false,
      failure: {
        error: 'Jira rate-limited selector discovery. Try again shortly.',
        status: 429,
      },
      upstreamStatus: 429,
    })
    expect(JSON.stringify(result)).not.toContain('provider-body-secret-marker')
  })
})
