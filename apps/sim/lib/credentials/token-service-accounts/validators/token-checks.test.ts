import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import {
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
  validateGongServiceAccount,
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
  validatePlanetScaleServiceAccount,
  validateResendServiceAccount,
  validateServiceNowServiceAccount,
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
    ['PlanetScale', validatePlanetScaleServiceAccount, { providerWorkspaceId: 'id:extra' }],
    ['Gong', validateGongServiceAccount, { providerWorkspaceId: 'key:extra' }],
    [
      'ServiceNow',
      validateServiceNowServiceAccount,
      { domain: 'evil.example.com', providerWorkspaceId: 'admin' },
    ],
    [
      'ServiceNow',
      validateServiceNowServiceAccount,
      { domain: 'acme.service-now.com.evil.example.com', providerWorkspaceId: 'admin' },
    ],
    [
      'ServiceNow',
      validateServiceNowServiceAccount,
      { domain: 'http://acme.service-now.com', providerWorkspaceId: 'admin' },
    ],
    [
      'ServiceNow',
      validateServiceNowServiceAccount,
      { domain: 'https://user:pass@acme.service-now.com', providerWorkspaceId: 'admin' },
    ],
    [
      'ServiceNow',
      validateServiceNowServiceAccount,
      { domain: 'acme.service-now.com', providerWorkspaceId: 'ad:min' },
    ],
    ['PlanetScale', validatePlanetScaleServiceAccount, { providerWorkspaceId: 'id with space' }],
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

describe('PlanetScale saved service token verification', () => {
  it('lists organizations with the token ID and token sent as the tools send them', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ type: 'list', data: [] }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      validatePlanetScaleServiceAccount({ apiToken: 'tok-secret', providerWorkspaceId: ' tok-id ' })
    ).resolves.toMatchObject({
      displayName: 'PlanetScale (tok-id)',
      normalizedWorkspaceId: 'tok-id',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.planetscale.com/v1/organizations',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'tok-id:tok-secret' }),
      })
    )
  })

  it('rejects a token PlanetScale answers with 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ code: 'unauthorized', message: 'Unauthorized' }, 401))
    )

    await expect(
      validatePlanetScaleServiceAccount({ apiToken: 'bad', providerWorkspaceId: 'tok-id' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('accepts a valid token that PlanetScale forbids from this read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'forbidden', message: 'Forbidden' }, 403))
    )

    await expect(
      validatePlanetScaleServiceAccount({ apiToken: 'scoped', providerWorkspaceId: 'tok-id' })
    ).resolves.toMatchObject({ principal: null })
  })

  it('does not take a proxy 403 page as proof of the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Forbidden</html>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    )

    await expect(
      validatePlanetScaleServiceAccount({ apiToken: 'any', providerWorkspaceId: 'tok-id' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('refuses a token the tools could not send, before any request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(
      validatePlanetScaleServiceAccount({ apiToken: 'tok:extra', providerWorkspaceId: 'tok-id' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Gong saved access key verification', () => {
  it('lists workspaces on the tools host with the Basic key and secret the tools send', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ requestId: 'r', workspaces: [] }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      validateGongServiceAccount({ apiToken: 'key-secret', providerWorkspaceId: ' KEY123 ' })
    ).resolves.toMatchObject({ displayName: 'Gong (KEY123)', normalizedWorkspaceId: 'KEY123' })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.gong.io/v2/workspaces',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: `Basic ${btoa('KEY123:key-secret')}` }),
      })
    )
  })

  it.each([401, 403])('rejects a key pair Gong answers with %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ requestId: 'r', errors: ['Access denied'] }, status))
    )

    await expect(
      validateGongServiceAccount({ apiToken: 'bad', providerWorkspaceId: 'KEY123' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('refuses a secret the tools could not encode, before any request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(
      validateGongServiceAccount({ apiToken: 'sécret-€', providerWorkspaceId: 'KEY123' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('ServiceNow saved username and password verification', () => {
  const secureFetch = inputValidationMockFns.mockSecureFetchWithPinnedIP

  function reply(response: Response) {
    inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.7',
      originalHostname: 'acme.service-now.com',
    })
    secureFetch.mockReset().mockResolvedValue(response)
  }

  it('reads one user on the instance origin with the Basic auth the tools send', async () => {
    reply(jsonResponse({ result: [{ sys_id: 'abc' }] }))

    await expect(
      validateServiceNowServiceAccount({
        apiToken: 'pass',
        providerWorkspaceId: ' integration.user ',
        domain: 'acme.service-now.com/nav_to.do?uri=incident.do',
      })
    ).resolves.toMatchObject({
      displayName: 'ServiceNow (https://acme.service-now.com)',
      normalizedDomain: 'https://acme.service-now.com',
      normalizedWorkspaceId: 'integration.user',
    })
    expect(secureFetch).toHaveBeenCalledWith(
      'https://acme.service-now.com/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id',
      '203.0.113.7',
      expect.objectContaining({
        method: 'GET',
        maxRedirects: 0,
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('integration.user:pass').toString('base64')}`,
        }),
      })
    )
  })

  it.each([
    [
      'rejects a password ServiceNow answers with 401',
      jsonResponse({ error: {} }, 401),
      'invalid_credentials',
    ],
    [
      'accepts a user whose ACLs refuse the user table',
      jsonResponse({ error: { message: 'User Not Authorized' }, status: 'failure' }, 403),
      null,
    ],
    [
      'does not take a hibernating instance page as proof',
      new Response('<html>Instance Hibernating</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
      'provider_unavailable',
    ],
  ] as const)('%s', async (_, response, code) => {
    reply(response)

    const result = validateServiceNowServiceAccount({
      apiToken: 'pass',
      providerWorkspaceId: 'admin',
      domain: 'https://acme.service-now.com',
    })

    if (code) await expect(result).rejects.toMatchObject({ code })
    else await expect(result).resolves.toMatchObject({ principal: null })
  })
})
