/**
 * Tests for the Gmail API mail provider
 *
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

afterAll(resetEnvMock)

const { mockJwtConstructor, mockGetAccessToken } = vi.hoisted(() => {
  const mockGetAccessToken = vi.fn()
  const jwtInstance = { getAccessToken: mockGetAccessToken }
  return {
    mockJwtConstructor: vi.fn().mockImplementation(
      class {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: vitest constructs mocks via Reflect.construct; returning the object overrides the instance so `new JWT()` yields the shared mock the tests assert on
          return jwtInstance
        }
      }
    ),
    mockGetAccessToken,
  }
})

vi.mock('google-auth-library', () => ({
  JWT: mockJwtConstructor,
}))

import { createGmailProvider } from '@/lib/messaging/email/providers/gmail'
import type { ProcessedEmailData } from '@/lib/messaging/email/types'

const VALID_CREDENTIALS = JSON.stringify({
  client_email: 'mailer@my-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
})

const BASE_DATA: ProcessedEmailData = {
  to: 'user@example.com',
  subject: 'Welcome to Sim',
  html: '<p>Hello</p>',
  senderEmail: 'Sim <noreply@sim.example>',
  headers: {},
}

const mockFetch = vi.fn()

describe('Gmail mail provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    setEnv({ GMAIL_SENDER: 'noreply@sim.example' })
    setEnv({ GMAIL_CREDENTIALS_JSON: VALID_CREDENTIALS })
    mockGetAccessToken.mockResolvedValue({ token: 'test-token' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('createGmailProvider', () => {
    it('returns null when neither GMAIL_SENDER nor GMAIL_CREDENTIALS_JSON is set', () => {
      setEnv({ GMAIL_SENDER: undefined })
      setEnv({ GMAIL_CREDENTIALS_JSON: undefined })

      expect(createGmailProvider()).toBeNull()
    })

    it('returns null when only one of the two variables is set', () => {
      setEnv({ GMAIL_CREDENTIALS_JSON: undefined })
      expect(createGmailProvider()).toBeNull()

      setEnv({ GMAIL_CREDENTIALS_JSON: VALID_CREDENTIALS })
      setEnv({ GMAIL_SENDER: undefined })
      expect(createGmailProvider()).toBeNull()
    })

    it('returns null for invalid or incomplete credentials JSON', () => {
      setEnv({ GMAIL_CREDENTIALS_JSON: 'not-json' })
      expect(createGmailProvider()).toBeNull()

      setEnv({ GMAIL_CREDENTIALS_JSON: JSON.stringify({ client_email: 'x@y.iam' }) })
      expect(createGmailProvider()).toBeNull()
    })

    it('creates a JWT client impersonating the configured sender with the gmail.send scope', () => {
      const provider = createGmailProvider()

      expect(provider?.name).toBe('gmail')
      expect(mockJwtConstructor).toHaveBeenCalledWith({
        email: 'mailer@my-project.iam.gserviceaccount.com',
        key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
        subject: 'noreply@sim.example',
      })
    })
  })

  describe('send', () => {
    it('posts the raw RFC 822 message to the Gmail media-upload endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-1', threadId: 'thr-1' }), { status: 200 })
      )

      const provider = createGmailProvider()
      const result = await provider!.send({
        ...BASE_DATA,
        headers: { 'List-Unsubscribe': '<https://sim.example/unsub>' },
        replyTo: 'help@sim.example',
      })

      expect(result).toEqual({
        success: true,
        message: 'Email sent successfully via Gmail',
        data: { id: 'msg-1' },
      })

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(
        'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media'
      )
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-token',
        'Content-Type': 'message/rfc822',
      })

      const raw = (init.body as Buffer).toString()
      expect(raw).toContain('To: user@example.com')
      expect(raw).toContain('Subject: Welcome to Sim')
      expect(raw).toContain('From: Sim <noreply@sim.example>')
      expect(raw).toContain('Reply-To: help@sim.example')
      expect(raw).toContain('List-Unsubscribe: <https://sim.example/unsub>')
      expect(raw).toContain('<p>Hello</p>')
    })

    it('encodes attachments into the MIME payload', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-2' }), { status: 200 })
      )

      const provider = createGmailProvider()
      await provider!.send({
        ...BASE_DATA,
        attachments: [
          {
            filename: 'report.txt',
            content: Buffer.from('report body'),
            contentType: 'text/plain',
          },
        ],
      })

      const [, init] = mockFetch.mock.calls[0]
      const raw = (init.body as Buffer).toString()
      expect(raw).toContain('Content-Type: text/plain; name=report.txt')
      expect(raw).toContain('Content-Disposition: attachment; filename=report.txt')
      expect(raw).toContain(Buffer.from('report body').toString('base64'))
    })

    it('joins multiple recipients into one To header', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-3' }), { status: 200 })
      )

      const provider = createGmailProvider()
      await provider!.send({ ...BASE_DATA, to: ['a@example.com', 'b@example.com'] })

      const [, init] = mockFetch.mock.calls[0]
      expect((init.body as Buffer).toString()).toContain('To: a@example.com, b@example.com')
    })

    it('sends text-only messages', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg-4' }), { status: 200 })
      )

      const provider = createGmailProvider()
      await provider!.send({ ...BASE_DATA, html: undefined, text: 'plain body' })

      const [, init] = mockFetch.mock.calls[0]
      const raw = (init.body as Buffer).toString()
      expect(raw).toContain('Content-Type: text/plain')
      expect(raw).toContain('plain body')
      expect(raw).not.toContain('text/html')
    })

    it('treats an accepted send with an empty response body as success (no fallback re-send)', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const provider = createGmailProvider()
      const result = await provider!.send(BASE_DATA)

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ id: undefined })
    })

    it('throws when no access token can be obtained', async () => {
      mockGetAccessToken.mockResolvedValueOnce({ token: null })

      const provider = createGmailProvider()
      await expect(provider!.send(BASE_DATA)).rejects.toThrow(
        'Failed to obtain a Gmail API access token'
      )
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('throws with status details when the Gmail API rejects the send', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Delegation denied' } }), {
          status: 403,
          statusText: 'Forbidden',
        })
      )

      const provider = createGmailProvider()
      await expect(provider!.send(BASE_DATA)).rejects.toThrow(
        'Gmail API send failed: 403 Forbidden'
      )
    })
  })
})
