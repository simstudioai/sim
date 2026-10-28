/**
 * @vitest-environment node
 */
import { createMockResponse } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { createKieFetch } from '@/providers/kie/transport'

const JSON_HEADERS = { 'content-type': 'application/json;charset=utf-8' }

const KIE_UNAUTHORIZED = {
  code: 401,
  msg: 'Unauthorized – Authentication failed. Please check that your Authorization and Content-Type headers are correctly set.',
}

function kieFetchReturning(response: Response): typeof fetch {
  return createKieFetch(async () => response)
}

describe('createKieFetch', () => {
  it('turns an HTTP 200 error envelope into the HTTP status it reports', async () => {
    const response = await kieFetchReturning(
      createMockResponse({ json: KIE_UNAUTHORIZED, headers: JSON_HEADERS })
    )('https://api.kie.ai')

    expect(response.status).toBe(401)
    expect(response.ok).toBe(false)
    expect(await response.json()).toEqual({
      type: 'error',
      error: { type: 'kie_error', message: KIE_UNAUTHORIZED.msg },
    })
  })

  it('keeps retry and tracing headers on a rewritten error', async () => {
    const response = await kieFetchReturning(
      createMockResponse({
        json: { code: 429, msg: 'Rate limited' },
        headers: {
          ...JSON_HEADERS,
          'retry-after': '7',
          'x-request-id': 'req_1',
          'content-length': '999',
        },
      })
    )('https://api.kie.ai')

    expect(response.headers.get('retry-after')).toBe('7')
    expect(response.headers.get('x-request-id')).toBe('req_1')
    expect(response.headers.get('content-length')).toBeNull()
  })

  it('matches the JSON content type case-insensitively', async () => {
    const response = await kieFetchReturning(
      createMockResponse({
        json: KIE_UNAUTHORIZED,
        headers: { 'content-type': 'Application/JSON; charset=UTF-8' },
      })
    )('https://api.kie.ai')

    expect(response.status).toBe(401)
  })

  it('treats an untyped JSON body as JSON and labels it', async () => {
    const message = { id: 'msg_1', type: 'message', content: [{ type: 'text', text: 'hi' }] }
    const response = await kieFetchReturning(
      new Response(new TextEncoder().encode(JSON.stringify(message)))
    )('https://api.kie.ai')

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual(message)
  })

  it('detects an error envelope in an untyped body', async () => {
    const response = await kieFetchReturning(
      new Response(new TextEncoder().encode(JSON.stringify(KIE_UNAUTHORIZED)))
    )('https://api.kie.ai')

    expect(response.status).toBe(401)
  })

  it.each([
    [429, 429],
    [455, 503],
    [505, 403],
    [0, 502],
    [9999, 502],
  ])('maps Kie-specific code %i to HTTP %i', async (code, status) => {
    const response = await kieFetchReturning(
      createMockResponse({ json: { code, msg: 'failure' }, headers: JSON_HEADERS })
    )('https://api.kie.ai')

    expect(response.status).toBe(status)
  })

  it('passes a real Anthropic message through with its body intact', async () => {
    const message = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'hi' }],
    }
    const response = await kieFetchReturning(
      createMockResponse({ json: message, headers: JSON_HEADERS })
    )('https://api.kie.ai')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(message)
  })

  it('passes a success envelope with code 200 through untouched', async () => {
    const body = { code: 200, msg: 'success', data: {} }
    const response = await kieFetchReturning(
      createMockResponse({ json: body, headers: JSON_HEADERS })
    )('https://api.kie.ai')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(body)
  })

  it('never buffers a streaming response', async () => {
    const stream = new Response('data: {"type":"response.created"}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
    const response = await kieFetchReturning(stream)('https://api.kie.ai')

    expect(response).toBe(stream)
    expect(stream.bodyUsed).toBe(false)
  })

  it('passes through a JSON body that is not valid JSON', async () => {
    const response = await kieFetchReturning(
      createMockResponse({ text: 'not json', headers: JSON_HEADERS })
    )('https://api.kie.ai')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('not json')
  })
})
