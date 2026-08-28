/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeResendSend } from '@/lib/internal/resend/operations'

describe('Resend operation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves HTML fallback text, tags, optional recipients, and cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ id: 'mail-1' }))
    await expect(
      executeResendSend(
        {
          resendApiKey: 'secret',
          fromAddress: 'from@example.com',
          to: 'to@example.com',
          subject: 'Hello',
          body: '<b>Hello</b>',
          contentType: 'html',
          cc: 'cc@example.com',
          replyTo: 'reply@example.com',
          tags: 'category:welcome, invalid, empty:',
        },
        controller.signal
      )
    ).resolves.toEqual({
      success: true,
      message: 'Email sent successfully via Resend',
      data: { id: 'mail-1' },
    })
    const init = fetchMock.mock.calls[0][1]
    expect(init?.signal).toBe(controller.signal)
    expect(JSON.parse(init?.body as string)).toMatchObject({
      from: 'from@example.com',
      to: 'to@example.com',
      subject: 'Hello',
      html: '<b>Hello</b>',
      text: 'Hello',
      cc: 'cc@example.com',
      reply_to: 'reply@example.com',
      tags: [
        { name: 'category', value: 'welcome' },
        { name: 'empty', value: '' },
      ],
    })
  })

  it('preserves the legacy 500 error envelope for provider failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ message: 'Invalid API key' }, { status: 401 })
    )
    await expect(
      executeResendSend({
        resendApiKey: 'bad',
        fromAddress: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hello',
        body: 'Hello',
      })
    ).rejects.toMatchObject({
      status: 500,
      body: { success: false, message: 'Failed to send email: Invalid API key' },
    })
  })
})
