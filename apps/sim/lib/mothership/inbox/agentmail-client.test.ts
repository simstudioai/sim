import { resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInbox,
  createWebhook,
  deleteInbox,
  deleteWebhook,
  getInbox,
} from '@/lib/mothership/inbox/agentmail-client'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  setEnv({ AGENTMAIL_API_KEY: 'test-key' })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetEnvMock()
})

describe('AgentMail resource deletion', () => {
  it.each([deleteInbox, deleteWebhook])(
    'accepts an empty 202 without attempting JSON parsing',
    async (remove) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
      await expect(remove('resource-id')).resolves.toBe(false)
    }
  )
  it.each([204, 404])('treats status %s as completed deletion', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    await expect(deleteInbox('resource-id')).resolves.toBe(true)
  })
  it('does not treat a conflict as completed deletion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }))
    await expect(deleteInbox('resource-id')).rejects.toThrow()
  })
  it('returns null only for a missing inbox', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(getInbox('resource-id')).resolves.toBeNull()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(getInbox('resource-id')).rejects.toThrow()
  })
  it('never exposes provider response bodies in user-facing errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('private provider diagnostic', { status: 400 }))
    await expect(createInbox({ username: 'test' })).rejects.toThrow('Check the email prefix')
  })

  it('reports an address conflict only when creating an inbox', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }))
    await expect(createInbox({ username: 'test' })).rejects.toThrow(
      'This email address is unavailable'
    )
  })
  it('reports webhook conflicts as a service failure instead of an address conflict', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }))
    await expect(
      createWebhook({
        url: 'https://example.com/webhook',
        eventTypes: ['message.received'],
        inboxIds: ['inbox@example.com'],
      })
    ).rejects.toThrow('The email service is unavailable')
  })
})
