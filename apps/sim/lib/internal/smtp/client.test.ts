/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ close: vi.fn(), create: vi.fn(), send: vi.fn() }))
vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.create },
}))

import { sendSmtpMessage } from '@/lib/internal/smtp/client'

const config = {
  host: '203.0.113.10',
  port: 465,
  secure: true,
  auth: { user: 'user', pass: 'password' },
  name: 'sim.example.com',
  tls: { rejectUnauthorized: true, servername: 'smtp.example.com' },
}

describe('SMTP client lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockReturnValue({ close: mocks.close, sendMail: mocks.send })
    mocks.send.mockResolvedValue({ messageId: 'message-1' })
  })

  it('closes the transporter after successful delivery', async () => {
    await expect(sendSmtpMessage(config, { to: 'to@example.com' })).resolves.toEqual({
      messageId: 'message-1',
    })
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('closes the transporter when execution aborts', async () => {
    const controller = new AbortController()
    mocks.send.mockImplementation(async () => {
      controller.abort(new Error('Execution aborted'))
      throw new Error('connection closed')
    })
    await expect(
      sendSmtpMessage(config, { to: 'to@example.com' }, controller.signal)
    ).rejects.toThrow()
    expect(mocks.close).toHaveBeenCalled()
  })
})
