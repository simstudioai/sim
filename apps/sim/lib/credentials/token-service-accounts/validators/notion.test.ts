/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateNotionServiceAccount } from '@/lib/credentials/token-service-accounts/validators/notion'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateNotionServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns bot metadata on success with a name', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        object: 'user',
        id: 'bot-123',
        type: 'bot',
        name: 'Ops Integration',
        bot: { workspace_name: 'Acme Workspace' },
      })
    )

    const result = await validateNotionServiceAccount({ apiToken: 'ntn_abc' })

    expect(result).toEqual({
      displayName: 'Ops Integration',
      auditMetadata: { notionBotId: 'bot-123' },
      storedMetadata: { botId: 'bot-123', workspaceName: 'Acme Workspace' },
    })
    expect(mockFetch).toHaveBeenCalledWith('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: 'Bearer ntn_abc',
        'Notion-Version': '2022-06-28',
        Accept: 'application/json',
      },
      signal: expect.any(AbortSignal),
    })
  })

  it('falls back to workspace name when name is empty', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        object: 'user',
        id: 'bot-456',
        type: 'bot',
        name: '',
        bot: { workspace_name: 'Acme Workspace' },
      })
    )

    const result = await validateNotionServiceAccount({ apiToken: 'secret_legacy' })

    expect(result.displayName).toBe('Acme Workspace')
    expect(result.auditMetadata).toEqual({ notionBotId: 'bot-456' })
    expect(result.storedMetadata).toEqual({
      botId: 'bot-456',
      workspaceName: 'Acme Workspace',
    })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { object: 'error', code: 'unauthorized' }))

    await expect(validateNotionServiceAccount({ apiToken: 'ntn_bad' })).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 401,
    })
  })

  it('throws provider_unavailable when a 200 body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>gateway</html>', { status: 200 }))

    const error = await validateNotionServiceAccount({ apiToken: 'ntn_abc' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })

  it('throws provider_unavailable on 502', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(502, { object: 'error' }))

    const error = await validateNotionServiceAccount({ apiToken: 'ntn_abc' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })
})
