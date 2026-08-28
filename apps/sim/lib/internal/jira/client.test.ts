/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudId: vi.fn(),
}))

vi.mock('@/tools/jira/utils', () => ({
  getJiraCloudId: mocks.getCloudId,
}))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { createJiraClient } from '@/lib/internal/jira/client'

describe('JiraClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mocks.getCloudId.mockResolvedValue('cloud-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes credentials and cancellation to Jira requests', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"1"}', { status: 200 }))
    const controller = new AbortController()
    const client = await createJiraClient(
      { accessToken: 'token', domain: 'example.atlassian.net', cloudId: 'cloud-1' },
      { signal: controller.signal, validateCloudId: true }
    )

    await expect(
      client.request(
        client.issuePath(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
        controller.signal
      )
    ).resolves.toMatchObject({ ok: true, text: '{"id":"1"}' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
      })
    )
  })

  it('caps provider response bodies before materializing them', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValue(
      new Response(stream, { headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) } })
    )
    const client = await createJiraClient(
      { accessToken: 'token', domain: 'example.atlassian.net', cloudId: 'cloud-1' },
      { validateCloudId: true }
    )

    await expect(client.request(client.issuePath(), { method: 'GET' })).rejects.toEqual(
      new PayloadSizeLimitError({
        label: 'Jira response',
        maxBytes: 10 * 1024 * 1024,
        observedBytes: 10 * 1024 * 1024 + 1,
      })
    )
    expect(cancelled).toBe(true)
  })

  it('cancels the caller wait while shared Atlassian discovery is in flight', async () => {
    mocks.getCloudId.mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const pending = createJiraClient(
      { accessToken: 'token', domain: 'example.atlassian.net' },
      { signal: controller.signal, validateCloudId: true }
    )
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed attachment cloud IDs before constructing request URLs', async () => {
    await expect(
      createJiraClient(
        {
          accessToken: 'token',
          domain: 'example.atlassian.net',
          cloudId: '../rest/api/3',
        },
        { validateCloudId: true }
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
