/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  appendModalQueryParams,
  extractModalError,
  modalOpenAiUrl,
  modalProxyAuthHeaders,
  modalWebFunctionUrl,
} from '@/tools/modal/utils'

describe('modalProxyAuthHeaders', () => {
  it('sends the token pair as Modal-Key/Modal-Secret so Authorization stays free', () => {
    expect(modalProxyAuthHeaders({ tokenId: 'wk-123', tokenSecret: 'ws-456' })).toEqual({
      'Modal-Key': 'wk-123',
      'Modal-Secret': 'ws-456',
    })
  })

  it('trims pasted whitespace off both halves of the pair', () => {
    expect(modalProxyAuthHeaders({ tokenId: ' wk-123 ', tokenSecret: '\tws-456\n' })).toEqual({
      'Modal-Key': 'wk-123',
      'Modal-Secret': 'ws-456',
    })
  })

  it('omits auth entirely when the pair is absent, for unauthenticated Web Functions', () => {
    expect(modalProxyAuthHeaders({})).toEqual({})
    expect(modalProxyAuthHeaders({ tokenId: 'wk-123' })).toEqual({})
    expect(modalProxyAuthHeaders({ tokenId: 'wk-123', tokenSecret: '   ' })).toEqual({})
  })

  it('fails loudly when a half is missing on an endpoint that always authenticates', () => {
    expect(() => modalProxyAuthHeaders({ tokenId: 'wk-123' }, { required: true })).toThrow(
      /token ID and token secret are required/
    )
  })
})

describe('modalOpenAiUrl', () => {
  it('appends the /v1 root the endpoint serves its API under', () => {
    expect(modalOpenAiUrl('https://my-endpoint.us-west.modal.direct', '/chat/completions')).toBe(
      'https://my-endpoint.us-west.modal.direct/v1/chat/completions'
    )
  })

  it('does not double the /v1 when the pasted URL already carries it', () => {
    expect(modalOpenAiUrl('https://inference.us-west.modal.direct/v1', '/models')).toBe(
      'https://inference.us-west.modal.direct/v1/models'
    )
  })

  it('tolerates trailing slashes from a copied dashboard URL', () => {
    expect(modalOpenAiUrl('https://inference.us-west.modal.direct//', '/models')).toBe(
      'https://inference.us-west.modal.direct/v1/models'
    )
  })

  it('rejects a cleartext URL rather than leaking the proxy token', () => {
    expect(() => modalOpenAiUrl('http://my-endpoint.modal.direct', '/models')).toThrow(/https/)
  })

  it('rejects a missing or relative URL', () => {
    expect(() => modalOpenAiUrl(undefined, '/models')).toThrow(/required/)
    expect(() => modalOpenAiUrl('my-endpoint.modal.direct', '/models')).toThrow(/absolute URL/)
  })
})

describe('modalWebFunctionUrl', () => {
  it('keeps the function path and drops the trailing slash', () => {
    expect(modalWebFunctionUrl('https://acme--app-fn.modal.run/predict/')).toBe(
      'https://acme--app-fn.modal.run/predict'
    )
  })

  it('rejects a cleartext function URL', () => {
    expect(() => modalWebFunctionUrl('http://acme--app-fn.modal.run')).toThrow(/https/)
  })
})

describe('appendModalQueryParams', () => {
  it('returns the URL untouched when there is nothing to append', () => {
    expect(appendModalQueryParams('https://acme--app-fn.modal.run', {})).toBe(
      'https://acme--app-fn.modal.run'
    )
  })

  it('encodes keys and values and joins onto an existing query string', () => {
    expect(appendModalQueryParams('https://acme--app-fn.modal.run?a=1', { 'b c': 'd&e' })).toBe(
      'https://acme--app-fn.modal.run?a=1&b%20c=d%26e'
    )
  })

  it('skips blank keys and null values so an empty table row adds nothing', () => {
    expect(
      appendModalQueryParams('https://acme--app-fn.modal.run', {
        '': 'orphan',
        keep: 'yes',
        drop: null,
      })
    ).toBe('https://acme--app-fn.modal.run?keep=yes')
  })
})

describe('extractModalError', () => {
  it('reads the proxy shape returned by a rejected token', async () => {
    const response = new Response(JSON.stringify({ error: 'invalid proxy auth credentials' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
    await expect(extractModalError(response, 'Modal chat completion failed')).resolves.toBe(
      'Modal chat completion failed (status 401): invalid proxy auth credentials'
    )
  })

  it('reads the nested OpenAI-compatible shape an inference server returns', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'model not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
    await expect(extractModalError(response, 'Modal chat completion failed')).resolves.toBe(
      'Modal chat completion failed (status 404): model not found'
    )
  })

  it('falls back to the raw body when a Web Function errors with plain text', async () => {
    const response = new Response('Traceback: boom', { status: 500 })
    await expect(extractModalError(response, 'Modal function call failed')).resolves.toBe(
      'Modal function call failed (status 500): Traceback: boom'
    )
  })

  it('reports the status alone when the error carries no body', async () => {
    const response = new Response(null, { status: 503 })
    await expect(extractModalError(response, 'Modal function call failed')).resolves.toBe(
      'Modal function call failed (status 503)'
    )
  })
})
