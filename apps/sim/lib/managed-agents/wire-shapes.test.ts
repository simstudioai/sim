/**
 * @vitest-environment node
 *
 * Pins the exact HTTP shape of every Managed Agents call: method, URL, and the
 * beta header each endpoint family requires. These are the details that cannot
 * be caught by types or by the payload-builder tests, and that silently break
 * if someone "tidies" a path or shares a header across endpoint families.
 *
 * Verified against https://platform.claude.com/docs/en/managed-agents/
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_MEMORY_BETA,
  archiveSession,
  createSession,
  deleteSession,
  getEnvironmentType,
  listSessionEvents,
  MANAGED_AGENTS_BETA,
  managedAgentsList,
  openSessionStream,
  retrieveSession,
  sendCustomToolResults,
  sendSessionEvents,
  sendToolConfirmations,
  updateSession,
} from '@/lib/managed-agents/session-client'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

const spyOn = (body: unknown = {}) => {
  const spy = vi.fn(async () => Response.json(body)) as unknown as typeof fetch
  global.fetch = spy
  return spy as unknown as ReturnType<typeof vi.fn>
}

const call = (spy: ReturnType<typeof vi.fn>) => {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit]
  const headers = init.headers as Record<string, string>
  return { url: url.split('?')[0], method: init.method, headers }
}

const AUTH = { apiKey: 'sk-ant-fake' }
const S = { ...AUTH, sessionId: 'sesn_1' }
const BASE = 'https://api.anthropic.com'

describe('Managed Agents wire shapes', () => {
  it.each([
    [
      'createSession',
      () => createSession({ ...AUTH, agentId: 'a', environmentId: 'e' }),
      'POST',
      `${BASE}/v1/sessions`,
    ],
    ['retrieveSession', () => retrieveSession(S), 'GET', `${BASE}/v1/sessions/sesn_1`],
    [
      'updateSession',
      () => updateSession({ ...S, title: 't' }),
      'POST',
      `${BASE}/v1/sessions/sesn_1`,
    ],
    ['deleteSession', () => deleteSession(S), 'DELETE', `${BASE}/v1/sessions/sesn_1`],
    ['archiveSession', () => archiveSession(S), 'POST', `${BASE}/v1/sessions/sesn_1/archive`],
    ['listSessionEvents', () => listSessionEvents(S), 'GET', `${BASE}/v1/sessions/sesn_1/events`],
    [
      'sendSessionEvents',
      () => sendSessionEvents({ ...S, events: [{ type: 'user.interrupt' }] }),
      'POST',
      `${BASE}/v1/sessions/sesn_1/events`,
    ],
    [
      'sendToolConfirmations',
      () => sendToolConfirmations({ ...S, confirmations: [{ toolUseId: 'x', result: 'allow' }] }),
      'POST',
      `${BASE}/v1/sessions/sesn_1/events`,
    ],
    [
      'sendCustomToolResults',
      () => sendCustomToolResults({ ...S, results: [{ customToolUseId: 'x', content: 'y' }] }),
      'POST',
      `${BASE}/v1/sessions/sesn_1/events`,
    ],
    [
      'getEnvironmentType',
      () => getEnvironmentType({ ...AUTH, environmentId: 'env_1' }),
      'GET',
      `${BASE}/v1/environments/env_1`,
    ],
  ])('%s hits %s %s with the managed-agents beta', async (_name, run, method, url) => {
    const spy = spyOn({ id: 'sesn_1', config: { type: 'cloud' } })
    await run()
    const c = call(spy)
    expect(c.method).toBe(method)
    expect(c.url).toBe(url)
    expect(c.headers['anthropic-beta']).toBe(MANAGED_AGENTS_BETA)
    expect(c.headers['anthropic-version']).toBe('2023-06-01')
    expect(c.headers['x-api-key']).toBe('sk-ant-fake')
  })

  it('opens the event stream as SSE', async () => {
    const spy = spyOn()
    await openSessionStream(S)
    const c = call(spy)
    expect(c.method).toBe('GET')
    expect(c.url).toBe(`${BASE}/v1/sessions/sesn_1/events/stream`)
    expect(c.headers.accept).toBe('text/event-stream')
  })

  it('sends the SEPARATE memory beta on memory-store reads, never the managed-agents one', async () => {
    // Combining the two headers on one request is a documented 400, so the
    // memory-store family must carry its own and only its own.
    const spy = spyOn({ data: [], next_page: null })
    await managedAgentsList({ ...AUTH, path: '/v1/memory_stores', beta: AGENT_MEMORY_BETA })
    const c = call(spy)
    expect(c.headers['anthropic-beta']).toBe(AGENT_MEMORY_BETA)
    expect(AGENT_MEMORY_BETA).not.toBe(MANAGED_AGENTS_BETA)
  })

  it('sets content-type only on requests that carry a body', async () => {
    const post = spyOn({ id: 'sesn_1' })
    await createSession({ ...AUTH, agentId: 'a', environmentId: 'e' })
    expect(call(post).headers['content-type']).toBe('application/json')

    const get = spyOn({ status: 'idle' })
    await retrieveSession(S)
    expect(call(get).headers['content-type']).toBeUndefined()
  })
})
