/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetch, mockValidateUrlWithDNS } = vi.hoisted(() => ({
  mockSecureFetch: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetch,
  validateAndPinProxyUrl: vi.fn(),
  validateUrlWithDNS: mockValidateUrlWithDNS,
}))

/**
 * `vitest.setup.ts` mocks the tool registry to `{}` because the real one pulls
 * ~5,907 modules. Registering just this tool keeps that saving while giving
 * `executeTool` the *same object reference* the spy below is attached to.
 */
vi.mock('@/tools/registry', async () => {
  const { getDocumentTool } = await import('@/tools/elasticsearch/get_document')
  return { tools: { elasticsearch_get_document: getDocumentTool } }
})

import { getDocumentTool } from '@/tools/elasticsearch/get_document'
import { executeTool } from '@/tools/index'

const PARAMS = {
  deploymentType: 'self_hosted',
  host: 'https://es.example.com:9200',
  authMethod: 'api_key',
  apiKey: 'test-key',
  index: 'products',
  documentId: 'nope',
}

function jsonResponse(status: number, statusText: string, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  })
}

describe('a 404 never reaches transformResponse', () => {
  let transformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    transformSpy = vi.spyOn(getDocumentTool, 'transformResponse')
  })

  afterEach(() => {
    transformSpy.mockRestore()
  })

  /**
   * Replaces an assertion that read `transformResponse.toString()` and checked it
   * did not contain the literal `'404'`. That passed for *any* rewrite, including
   * one that reintroduced a `found: false` branch under a different spelling, and
   * it was the only guard on the behavior the elasticsearch error extractor
   * depends on. The guarantee is a property of the executor, not of the source
   * text: `executeTool` reads the body and throws on `!response.ok` before
   * `transformResponse` is ever invoked.
   */
  it('fails the call and leaves transformResponse uncalled on a missing document', async () => {
    mockSecureFetch.mockResolvedValue(
      jsonResponse(404, 'Not Found', { _index: 'products', _id: 'nope', found: false })
    )

    const result = await executeTool('elasticsearch_get_document', PARAMS, {
      skipPostProcess: true,
    })

    expect(result.success).toBe(false)
    expect(transformSpy).not.toHaveBeenCalled()
    expect(result.output?.found).toBeUndefined()
  })

  it('surfaces the named missing-document message rather than a bare "Not Found"', async () => {
    mockSecureFetch.mockResolvedValue(
      jsonResponse(404, 'Not Found', { _index: 'products', _id: 'nope', found: false })
    )

    const result = await executeTool('elasticsearch_get_document', PARAMS, {
      skipPostProcess: true,
    })

    expect(result.error).toBe('Document "nope" was not found in index "products"')
  })

  it('surfaces the reason and never the WWW-Authenticate challenge on a 401', async () => {
    mockSecureFetch.mockResolvedValue(
      jsonResponse(401, 'Unauthorized', {
        error: {
          root_cause: [
            {
              type: 'security_exception',
              reason: 'missing authentication credentials for REST request [/products/_doc/nope]',
              header: { 'WWW-Authenticate': ['Basic realm="security"', 'ApiKey'] },
            },
          ],
          type: 'security_exception',
          reason: 'missing authentication credentials for REST request [/products/_doc/nope]',
          header: { 'WWW-Authenticate': ['Basic realm="security"', 'ApiKey'] },
        },
        status: 401,
      })
    )

    const result = await executeTool('elasticsearch_get_document', PARAMS, {
      skipPostProcess: true,
    })

    expect(result.success).toBe(false)
    expect(transformSpy).not.toHaveBeenCalled()
    expect(result.error).toBe(
      'security_exception: missing authentication credentials for REST request [/products/_doc/nope]'
    )
    expect(result.error).not.toContain('WWW-Authenticate')
  })

  it('still runs transformResponse on a 200, so the guard is not vacuous', async () => {
    mockSecureFetch.mockResolvedValue(
      jsonResponse(200, 'OK', {
        _index: 'products',
        _id: 'abc',
        _version: 3,
        found: true,
        _source: { name: 'Widget' },
      })
    )

    const result = await executeTool('elasticsearch_get_document', PARAMS, {
      skipPostProcess: true,
    })

    expect(transformSpy).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    expect(result.output?.found).toBe(true)
  })
})
