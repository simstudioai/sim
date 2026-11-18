import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSendGridMail } from '@/lib/internal/sendgrid/client'

describe('SendGrid mail send', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 202, headers: { 'X-Message-Id': 'm-1' } }))
    vi.stubGlobal('fetch', fetchMock)
  })

  it.each([
    [undefined, 'https://api.sendgrid.com/v3/mail/send'],
    ['global', 'https://api.sendgrid.com/v3/mail/send'],
    ['eu', 'https://api.eu.sendgrid.com/v3/mail/send'],
  ])('sends mail for a %s key through %s', async (region, url) => {
    await expect(sendSendGridMail('key', region, { subject: 'Hi' })).resolves.toBe('m-1')
    expect(fetchMock.mock.calls[0][0]).toBe(url)
  })

  it('refuses a region it does not know without sending the key', async () => {
    await expect(sendSendGridMail('key', 'mars', { subject: 'Hi' })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
