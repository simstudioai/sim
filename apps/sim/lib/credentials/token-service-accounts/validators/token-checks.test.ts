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
    ['the account is suspended', { code: 'account_suspended', message: 'Forbidden' }, 403],
    [
      'an API gateway denies the request',
      { Message: 'User is not authorized to access this resource with an explicit deny' },
      403,
    ],
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

describe('New Relic saved User key verification', () => {
  it('reports a NerdGraph error answer without a user as an outage, not a bad key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: { actor: null },
          errors: [
            {
              message: 'Internal Server Error',
              extensions: { errorClass: 'INTERNAL_SERVER_ERROR' },
            },
          ],
        })
      )
    )

    await expect(
      validateNewRelicServiceAccount({ apiToken: 'NRAK-valid', domain: 'us' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it('rejects a key NerdGraph names as bad in its errors array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: { actor: null },
          errors: [{ message: 'Invalid API key', extensions: { error_code: 'BAD_API_KEY' } }],
        })
      )
    )

    await expect(
      validateNewRelicServiceAccount({ apiToken: 'NRAK-bad', domain: 'us' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('still rejects a NerdGraph answer that resolves no user and reports no error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { actor: { user: null } } }))
    )

    await expect(
      validateNewRelicServiceAccount({ apiToken: 'NRAK-unknown', domain: 'us' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
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
      // Both transports would answer, so only the refusal itself can keep the key unsent.
      const fetch = vi.fn().mockResolvedValue(jsonResponse({}, 401))
      vi.stubGlobal('fetch', fetch)
      inputValidationMockFns.mockValidateUrlWithDNS.mockReset().mockResolvedValue({
        isValid: true,
        resolvedIP: '203.0.113.7',
        originalHostname: 'instance.example.com',
      })
      inputValidationMockFns.mockSecureFetchWithPinnedIP
        .mockReset()
        .mockResolvedValue(jsonResponse({}, 401))

      await expect(validate({ apiToken: 'secret', ...typed })).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
      expect(fetch).not.toHaveBeenCalled()
      expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
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

  it('rejects a JSON 403, which PlanetScale does not document as a valid token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'forbidden', message: 'Forbidden' }, 403))
    )

    await expect(
      validatePlanetScaleServiceAccount({ apiToken: 'any', providerWorkspaceId: 'tok-id' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
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

  it('verifies an instance on a custom URL, as the earlier block allowed', async () => {
    reply(jsonResponse({ result: [{ sys_id: 'abc' }] }))

    await expect(
      validateServiceNowServiceAccount({
        apiToken: 'pass',
        providerWorkspaceId: 'admin',
        domain: 'support.acme.example',
      })
    ).resolves.toMatchObject({ normalizedDomain: 'https://support.acme.example' })
    expect(secureFetch).toHaveBeenCalledWith(
      'https://support.acme.example/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id',
      '203.0.113.7',
      expect.objectContaining({ maxRedirects: 0 })
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

describe('Twilio saved credential verification', () => {
  const ACCOUNT_SID = `AC${'a'.repeat(32)}`
  const API_KEY_SID = `SK${'b'.repeat(32)}`

  it('checks an auth token against the account resource, as before', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ sid: ACCOUNT_SID }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      validateTwilioServiceAccount({ apiToken: 'c'.repeat(32), providerWorkspaceId: ACCOUNT_SID })
    ).resolves.toMatchObject({ displayName: `Twilio (${ACCOUNT_SID})` })
    expect(fetch).toHaveBeenCalledWith(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}.json`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${'c'.repeat(32)}`).toString('base64')}`,
        }),
      })
    )
  })

  it('checks an API key with a read a Standard key may make, sent as the key SID and secret', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ incoming_phone_numbers: [] }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      validateTwilioServiceAccount({
        apiToken: `${API_KEY_SID}:key-secret`,
        providerWorkspaceId: ACCOUNT_SID,
      })
    ).resolves.toMatchObject({ displayName: `Twilio (${ACCOUNT_SID})` })
    expect(fetch).toHaveBeenCalledWith(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=1`,
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from(`${API_KEY_SID}:key-secret`).toString('base64')}`,
        }),
      })
    )
  })

  it('rejects an API key Twilio refuses for this account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 20003, message: 'Authenticate' }, 401))
    )

    await expect(
      validateTwilioServiceAccount({
        apiToken: `${API_KEY_SID}:wrong`,
        providerWorkspaceId: ACCOUNT_SID,
      })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it.each([`SKshort:secret`, `${API_KEY_SID}:`, `${ACCOUNT_SID}:secret`, 'token:with:colons'])(
    'refuses %s, which is neither an auth token nor an API key, before any request',
    async (apiToken) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)

      await expect(
        validateTwilioServiceAccount({ apiToken, providerWorkspaceId: ACCOUNT_SID })
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )
})
