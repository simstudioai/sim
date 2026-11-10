import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import {
  validateAlgoliaServiceAccount,
  validateAshbyServiceAccount,
  validateAzureDevOpsServiceAccount,
  validateBrexServiceAccount,
  validateDevinServiceAccount,
  validateElevenLabsServiceAccount,
  validateFlintServiceAccount,
  validateInstantlyServiceAccount,
  validateJotformServiceAccount,
  validateMailgunServiceAccount,
  validateNewRelicServiceAccount,
  validateOktaServiceAccount,
  validateResendServiceAccount,
  validateSupabaseServiceAccount,
  validateThriveServiceAccount,
  validateTwilioServiceAccount,
  validateTypeformServiceAccount,
  validateVercelServiceAccount,
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

describe('Ashby saved API key verification', () => {
  it('accepts a valid key that lacks the read permission for this endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: false, errorInfo: { code: 'missing_endpoint_permission' } }, 403)
        )
    )

    await expect(validateAshbyServiceAccount({ apiToken: 'scoped' })).resolves.toMatchObject({
      displayName: 'Ashby',
    })
  })

  it('accepts a valid key whose missing permission Ashby names in its errors list', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { success: false, errors: [{ message: 'missing_endpoint_permission' }] },
            403
          )
        )
    )

    await expect(validateAshbyServiceAccount({ apiToken: 'scoped' })).resolves.toMatchObject({
      displayName: 'Ashby',
    })
  })

  it('rejects a deactivated key Ashby answers with a 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ success: false, errorInfo: { code: 'invalid_api_key' } }, 403)
        )
    )

    await expect(validateAshbyServiceAccount({ apiToken: 'revoked' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })
})

describe('Resend saved API key verification', () => {
  it('accepts a sending-only key Resend refuses for listing domains', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ name: 'restricted_api_key', message: 'restricted' }, 401))
    )

    await expect(validateResendServiceAccount({ apiToken: 're_send' })).resolves.toMatchObject({
      displayName: 'Resend',
    })
  })

  it('rejects an unknown key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ name: 'validation_error', message: 'API key is invalid' }, 401)
        )
    )

    await expect(validateResendServiceAccount({ apiToken: 're_bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })
})

describe('Typeform saved token verification', () => {
  it('rejects an unknown token Typeform answers with a 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'AUTHENTICATION_FAILED' }, 403))
    )

    await expect(validateTypeformServiceAccount({ apiToken: 'bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })
})

describe('Vercel saved token verification', () => {
  it('rejects an unknown token Vercel flags as invalid in its 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { code: 'forbidden', invalidToken: true } }, 403))
    )

    await expect(validateVercelServiceAccount({ apiToken: 'bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('accepts a valid token without access to the user record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'forbidden' } }, 403))
    )

    await expect(validateVercelServiceAccount({ apiToken: 'scoped' })).resolves.toMatchObject({
      displayName: 'Vercel',
    })
  })
})

describe('ElevenLabs saved API key verification', () => {
  it('accepts a valid key without the user permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ detail: { status: 'missing_permissions', message: 'user_read' } }, 401)
        )
    )

    await expect(
      validateElevenLabsServiceAccount({ apiToken: 'sk_scoped' })
    ).resolves.toMatchObject({ displayName: 'ElevenLabs' })
  })

  it('rejects an unknown key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { detail: { status: 'invalid_api_key', message: 'API key is invalid.' } },
            400
          )
        )
    )

    await expect(validateElevenLabsServiceAccount({ apiToken: 'sk_bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })
})

describe('saved credentials whose connection names a host, region, or account', () => {
  it.each([
    ['Algolia', validateAlgoliaServiceAccount, { providerWorkspaceId: 'evil.example.com/' }],
    ['Azure DevOps', validateAzureDevOpsServiceAccount, { providerWorkspaceId: 'org/../other' }],
    ['Devin', validateDevinServiceAccount, { providerWorkspaceId: 'org/sessions?x' }],
    ['Jotform', validateJotformServiceAccount, { domain: 'evil' }],
    ['Mailgun', validateMailgunServiceAccount, { domain: 'mars' }],
    ['New Relic', validateNewRelicServiceAccount, { domain: 'mars' }],
    ['Okta', validateOktaServiceAccount, { domain: 'evil.example.com' }],
    ['Supabase', validateSupabaseServiceAccount, { domain: 'ref.evil.example.com' }],
    [
      'Thrive',
      validateThriveServiceAccount,
      { domain: 'evil.example.com', providerWorkspaceId: 't1' },
    ],
    ['Twilio', validateTwilioServiceAccount, { providerWorkspaceId: 'AC123/../Messages' }],
  ])(
    '%s refuses a typed value that could steer the request, before sending the key',
    async (_, validate, typed) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)

      await expect(validate({ apiToken: 'secret', ...typed })).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('rejects an Azure DevOps key that a public organization answers as an anonymous visitor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          authenticatedUser: {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            descriptor: 'System:PublicAccess;aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          },
        })
      )
    )

    await expect(
      validateAzureDevOpsServiceAccount({ apiToken: 'bad', providerWorkspaceId: 'public-org' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })
})
