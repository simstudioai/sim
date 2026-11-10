import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import { validateFlintServiceAccount } from '@/lib/credentials/token-service-accounts/validators/token-checks'

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
