/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { modalCallFunctionTool } from '@/tools/modal/call_function'
import type { ModalCallFunctionParams } from '@/tools/modal/types'

const transform = modalCallFunctionTool.transformResponse!
const buildUrl = modalCallFunctionTool.request.url as (params: ModalCallFunctionParams) => string
const buildHeaders = modalCallFunctionTool.request.headers as (
  params: ModalCallFunctionParams
) => Record<string, string>
const buildBody = modalCallFunctionTool.request.body as (params: ModalCallFunctionParams) => unknown
const resolveMethod = modalCallFunctionTool.request.method as (
  params: ModalCallFunctionParams
) => string

describe('modalCallFunctionTool request', () => {
  it('defaults to POST and appends query parameters from a table', () => {
    const params = {
      url: 'https://acme--app-fn.modal.run',
      queryParams: [{ id: '1', cells: { Key: 'debug', Value: 'true' } }],
    }
    expect(resolveMethod(params)).toBe('POST')
    expect(buildUrl(params)).toBe('https://acme--app-fn.modal.run?debug=true')
  })

  it('normalizes a lowercase method so the bodyless check still matches', () => {
    const params = { url: 'https://acme--app-fn.modal.run', method: 'get', body: { a: 1 } }
    expect(resolveMethod(params)).toBe('GET')
    expect(buildBody(params)).toBeUndefined()
  })

  it('drops a stale body on GET, so switching the method after typing one is safe', () => {
    const params = { url: 'https://acme--app-fn.modal.run', method: 'GET', body: '{"a":1}' }
    expect(buildBody(params)).toBeUndefined()
    expect(buildHeaders(params)).not.toHaveProperty('Content-Type')
  })

  it('passes a JSON string through untouched so the transport does not double-encode it', () => {
    const params = { url: 'https://acme--app-fn.modal.run', body: '{"a":1}' }
    expect(buildBody(params)).toBe('{"a":1}')
    expect(buildHeaders(params)['Content-Type']).toBe('application/json')
  })

  it('lets a caller-supplied content type win over the JSON default', () => {
    const params = {
      url: 'https://acme--app-fn.modal.run',
      body: 'a=1',
      headers: [
        { id: '1', cells: { Key: 'Content-Type', Value: 'application/x-www-form-urlencoded' } },
      ],
    }
    expect(buildHeaders(params)['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('omits proxy auth for an unauthenticated Web Function', () => {
    const headers = buildHeaders({ url: 'https://acme--app-fn.modal.run' })
    expect(headers).not.toHaveProperty('Modal-Key')
    expect(headers).not.toHaveProperty('Modal-Secret')
  })
})

describe('modalCallFunctionTool transformResponse', () => {
  it('parses a JSON body the function returned', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    await expect(transform(response)).resolves.toMatchObject({
      success: true,
      output: { data: { ok: true }, status: 200 },
    })
  })

  it('surfaces a mislabelled JSON body as raw text instead of failing the call', async () => {
    const response = new Response('not json at all', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    await expect(transform(response)).resolves.toMatchObject({
      success: true,
      output: { data: 'not json at all', status: 200 },
    })
  })

  it('returns a non-JSON body verbatim', async () => {
    const response = new Response('plain text', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
    await expect(transform(response)).resolves.toMatchObject({ output: { data: 'plain text' } })
  })

  it('raises the function error rather than reporting success on a 500', async () => {
    const response = new Response(JSON.stringify({ error: 'boom' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
    await expect(transform(response)).rejects.toThrow(
      'Modal function call failed (status 500): boom'
    )
  })

  it('refuses a response body past the size cap instead of buffering it', async () => {
    const response = new Response('x'.repeat(64), {
      status: 200,
      headers: { 'content-type': 'text/plain', 'content-length': String(64 * 1024 * 1024) },
    })
    await expect(transform(response)).rejects.toThrow(/exceeds maximum size/)
  })
})
