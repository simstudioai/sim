import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ materialize: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/internal/mail/attachment-materialization', async () => ({
  MailAttachmentMaterializationError: class extends Error {},
  materializeAuthorizedMailAttachments: mocks.materialize,
}))
vi.mock('@/lib/internal/smtp/client', () => ({ sendSmtpMessage: mocks.send }))
vi.mock('@/lib/messaging/email/ehlo', () => ({ getSmtpEhloName: () => 'sim.example.com' }))

import { executeSmtpSend } from '@/lib/internal/smtp/operations'

const { mockValidateDatabaseHost } = inputValidationMockFns

const base = {
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpUsername: 'user',
  smtpPassword: 'password',
  smtpSecure: 'SSL' as const,
  from: 'from@example.com',
  to: 'to@example.com',
  subject: 'Hello',
  body: '<b>Hello</b>',
  contentType: 'html' as const,
}
const context = { requestId: 'request-1', userId: 'user-1', signal: new AbortController().signal }

describe('SMTP operation', () => {
  beforeEach(() => {
    mockValidateDatabaseHost.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.materialize.mockResolvedValue([])
    mocks.send.mockResolvedValue({ messageId: 'message-1' })
  })

  it('pins DNS while preserving TLS SNI, SSL, EHLO, and message behavior', async () => {
    await expect(executeSmtpSend({ ...base, fromName: 'Sender' }, context)).resolves.toEqual({
      success: true,
      messageId: 'message-1',
      to: 'to@example.com',
      subject: 'Hello',
    })
    expect(mocks.send).toHaveBeenCalledWith(
      {
        host: '203.0.113.10',
        port: 465,
        secure: true,
        auth: { user: 'user', pass: 'password' },
        name: 'sim.example.com',
        tls: { rejectUnauthorized: true, servername: 'smtp.example.com' },
      },
      expect.objectContaining({
        from: '"Sender" <from@example.com>',
        to: 'to@example.com',
        subject: 'Hello',
        html: '<b>Hello</b>',
      }),
      context.signal
    )
  })

  it('rejects unsafe SMTP destinations before creating a transport', async () => {
    mockValidateDatabaseHost.mockResolvedValue({ isValid: false, error: 'Private address' })
    await expect(executeSmtpSend(base, context)).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Private address' },
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
