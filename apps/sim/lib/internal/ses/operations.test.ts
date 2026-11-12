import { SESv2Client } from '@aws-sdk/client-sesv2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeSesSendBulkEmail,
  executeSesSendEmail,
  executeSesSendTemplatedEmail,
} from '@/lib/internal/ses/operations'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'secret',
}

function captureSentInput() {
  const send = vi
    .spyOn(SESv2Client.prototype, 'send')
    .mockImplementation(async () => ({ MessageId: 'message-id', BulkEmailEntryResults: [] }))
  return () => (send.mock.calls[0]?.[0] as { input: Record<string, unknown> }).input
}

describe('SES send operations', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends Reply-To on a templated email', async () => {
    const sentInput = captureSentInput()

    await executeSesSendTemplatedEmail({
      ...CONNECTION,
      fromAddress: 'sender@example.com',
      toAddresses: 'to@example.com',
      templateName: 'welcome',
      templateData: '{}',
      replyToAddresses: 'support@example.com, sales@example.com',
    })

    expect(sentInput().ReplyToAddresses).toEqual(['support@example.com', 'sales@example.com'])
  })

  it('keeps per-destination Cc and Bcc on a bulk send', async () => {
    const sentInput = captureSentInput()

    await executeSesSendBulkEmail({
      ...CONNECTION,
      fromAddress: 'sender@example.com',
      templateName: 'welcome',
      destinations: JSON.stringify([
        {
          toAddresses: ['to@example.com'],
          ccAddresses: ['cc@example.com'],
          bccAddresses: ['bcc@example.com'],
        },
      ]),
    })

    expect(sentInput().BulkEmailEntries).toEqual([
      {
        Destination: {
          ToAddresses: ['to@example.com'],
          CcAddresses: ['cc@example.com'],
          BccAddresses: ['bcc@example.com'],
        },
      },
    ])
  })

  it('encodes a non-ASCII friendly From name and quotes an ASCII one', async () => {
    const sentInput = captureSentInput()

    await executeSesSendEmail({
      ...CONNECTION,
      fromAddress: 'sender@example.com',
      fromName: 'Café "Ops"',
      toAddresses: 'to@example.com',
      subject: 'Hi',
      bodyText: 'Hello',
    })
    await executeSesSendEmail({
      ...CONNECTION,
      fromAddress: 'sender@example.com',
      fromName: 'Acme "Ops"',
      toAddresses: 'to@example.com',
      subject: 'Hi',
      bodyText: 'Hello',
    })

    const send = vi.mocked(SESv2Client.prototype.send)
    const fromOf = (index: number) =>
      (send.mock.calls[index]?.[0] as { input: { FromEmailAddress: string } }).input
        .FromEmailAddress
    expect(sentInput().FromEmailAddress).toBe(
      `=?utf-8?B?${Buffer.from('Café "Ops"').toString('base64')}?= <sender@example.com>`
    )
    expect(fromOf(1)).toBe('"Acme \\"Ops\\"" <sender@example.com>')
  })
})
