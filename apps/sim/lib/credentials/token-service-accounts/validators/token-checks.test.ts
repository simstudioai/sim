import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import {
  validateBrexServiceAccount,
  validateFlintServiceAccount,
  validateInstantlyServiceAccount,
  validateYouTubeServiceAccount,
} from '@/lib/credentials/token-service-accounts/validators/token-checks'

describe('Flint saved API key verification', () => {
  it("accepts a key Flint answers with its own 'Task not found' for an unknown task", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Task not found' }, 404))
    )

    await expect(validateFlintServiceAccount({ apiToken: 'ak_valid' })).resolves.toMatchObject({
      displayName: 'Flint',
    })
  })

  it('rejects a key Flint refuses before the task lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Authentication Error', { status: 401 }))
    )

    await expect(validateFlintServiceAccount({ apiToken: 'bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('does not treat a proxy 404 page as proof of the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Not Found</html>', {
          status: 404,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    )

    await expect(validateFlintServiceAccount({ apiToken: 'any' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})

describe('Brex saved token verification', () => {
  it('rejects an unknown token Brex answers with its scope-style 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ type: 'FORBIDDEN', message: 'Invalid or Revoked Token' }, 403)
        )
    )

    await expect(validateBrexServiceAccount({ apiToken: 'bxt_unknown' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('does not accept a 403 whose body cannot be read to tell a bad token apart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"message": "Invalid or Revoked', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

    await expect(validateBrexServiceAccount({ apiToken: 'bxt_unknown' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it('accepts a valid token that only lacks the user scope', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ type: 'FORBIDDEN', message: 'Insufficient scope for this request' }, 403)
        )
    )

    await expect(validateBrexServiceAccount({ apiToken: 'bxt_scoped' })).resolves.toMatchObject({
      displayName: 'Brex',
    })
  })
})

describe('saved key verification for vendors with scoped keys', () => {
  it('accepts a valid Instantly key that lacks the campaigns scope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'Insufficient scope' }, 403))
    )

    await expect(validateInstantlyServiceAccount({ apiToken: 'leads-only' })).resolves.toBeTruthy()
  })

  it('accepts a valid YouTube key that is out of quota for today', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403)
        )
    )

    await expect(validateYouTubeServiceAccount({ apiToken: 'AIza-valid' })).resolves.toBeTruthy()
  })

  it('rejects a YouTube key whose project has the API turned off', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } }, 403)
        )
    )

    await expect(validateYouTubeServiceAccount({ apiToken: 'AIza-off' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })
})
