import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import {
  validateAgentMailServiceAccount,
  validateAlgoliaServiceAccount,
  validateAshbyServiceAccount,
  validateAzureDevOpsServiceAccount,
  validateBrexServiceAccount,
  validateConvexServiceAccount,
  validateDevinServiceAccount,
  validateDynatraceServiceAccount,
  validateElevenLabsServiceAccount,
  validateEmailBisonServiceAccount,
  validateFlintServiceAccount,
  validateGrafanaServiceAccount,
  validateInfisicalServiceAccount,
  validateInstantlyServiceAccount,
  validateJotformServiceAccount,
  validateJupyterServiceAccount,
  validateLogfireServiceAccount,
  validateMailgunServiceAccount,
  validateNewRelicServiceAccount,
  validateOktaServiceAccount,
  validatePlaneServiceAccount,
  validateResendServiceAccount,
  validateSupabaseServiceAccount,
  validateThriveServiceAccount,
  validateTinybirdServiceAccount,
  validateTwilioServiceAccount,
  validateTypeformServiceAccount,
  validateUpstashServiceAccount,
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

describe('AgentMail saved API key verification', () => {
  it.each([
    ['lacks a permission the inbox listing needs', 'missing_permission'],
    ['is scoped to a pod or inbox, not the organization', 'forbidden'],
  ])('accepts a valid key that %s', async (_case, code) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ name: 'ForbiddenError', code, message: 'Forbidden' }, 403)
        )
    )

    await expect(validateAgentMailServiceAccount({ apiToken: 'am_scoped' })).resolves.toMatchObject(
      { displayName: 'AgentMail' }
    )
  })

  it.each([
    ['the gateway refuses with a bare Forbidden', { message: 'Forbidden' }, 403],
    ['the key is unknown', { code: 'unknown_api_key', message: 'Unauthorized' }, 401],
    ['the key has expired', { code: 'api_key_expired', message: 'Unauthorized' }, 401],
  ])('rejects the key when %s', async (_case, body, status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)))

    await expect(validateAgentMailServiceAccount({ apiToken: 'am_bad' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('reports an outage, not a bad key, for an uncoded gateway error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'Internal server error' }, 502))
    )

    await expect(validateAgentMailServiceAccount({ apiToken: 'am_any' })).rejects.toMatchObject({
      code: 'provider_unavailable',
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

describe('saved credentials for a host the user chose', () => {
  const HOST_CHOSEN_VALIDATORS = [
    ['Convex', validateConvexServiceAccount],
    ['Dynatrace', validateDynatraceServiceAccount],
    ['Email Bison', validateEmailBisonServiceAccount],
    ['Grafana', validateGrafanaServiceAccount],
    ['Infisical', validateInfisicalServiceAccount],
    ['Jupyter', validateJupyterServiceAccount],
    ['Logfire', validateLogfireServiceAccount],
    ['Plane', validatePlaneServiceAccount],
    ['Tinybird', validateTinybirdServiceAccount],
    ['Upstash', validateUpstashServiceAccount],
  ] as const

  it.each(HOST_CHOSEN_VALIDATORS)(
    '%s refuses credentials smuggled into the URL before sending the key anywhere',
    async (_, validate) => {
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockReset()

      await expect(
        validate({ apiToken: 'secret', domain: 'https://user:pass@instance.example.com' })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )

  it.each(HOST_CHOSEN_VALIDATORS)(
    '%s refuses a non-http scheme instead of reading it as a host',
    async (_, validate) => {
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockReset()

      await expect(
        validate({ apiToken: 'secret', domain: 'ftp://instance.example.com' })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    }
  )
})

describe('saved credentials whose vendor answers a restricted token in its error', () => {
  const secureFetch = inputValidationMockFns.mockSecureFetchWithPinnedIP

  it.each([
    [
      'rejects an unknown Tinybird token',
      validateTinybirdServiceAccount,
      jsonResponse({ error: 'invalid authentication token. Token tok not found' }, 403),
      'invalid_credentials',
    ],
    [
      'accepts a Tinybird token without read access',
      validateTinybirdServiceAccount,
      jsonResponse({ error: 'Not enough permissions to read from datasources' }, 403),
      null,
    ],
    [
      'accepts an Upstash token whose ACL refuses PING',
      validateUpstashServiceAccount,
      jsonResponse({ error: 'NOPERM this user has no permissions to run the ping command' }, 400),
      null,
    ],
    [
      'rejects an unknown Upstash token',
      validateUpstashServiceAccount,
      jsonResponse({ error: 'WRONGPASS invalid or missing auth token' }, 401),
      'invalid_credentials',
    ],
  ])('%s', async (_, validate, reply, code) => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.7',
      originalHostname: 'instance.example.com',
    })
    secureFetch.mockReset().mockResolvedValue(reply)

    const result = validate({ apiToken: 'tok', domain: 'https://instance.example.com' })

    if (code) await expect(result).rejects.toMatchObject({ code })
    else await expect(result).resolves.toMatchObject({ principal: null })
  })
})
