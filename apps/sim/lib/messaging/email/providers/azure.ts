import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { env } from '@/lib/core/config/env'
import type { MailProvider, ProcessedEmailData, SendEmailResult } from '@/lib/messaging/email/types'

function extractBareAddress(addressOrFormatted: string): string {
  if (!addressOrFormatted.includes('<')) return addressOrFormatted
  return addressOrFormatted.match(/<(.+)>/)?.[1] ?? addressOrFormatted
}

export function createAzureProvider(): MailProvider | null {
  const connectionString = env.AZURE_ACS_CONNECTION_STRING
  if (!connectionString || connectionString.trim() === '') return null
  const client = new EmailClient(connectionString)

  return {
    name: 'azure',
    async send(data: ProcessedEmailData): Promise<SendEmailResult> {
      if (!data.html && !data.text) {
        throw new Error('Azure Communication Services requires either HTML or text content')
      }

      const message: EmailMessage = {
        senderAddress: extractBareAddress(data.senderEmail),
        content: data.html
          ? { subject: data.subject, html: data.html }
          : { subject: data.subject, plainText: data.text as string },
        recipients: {
          to: (Array.isArray(data.to) ? data.to : [data.to]).map((address) => ({ address })),
        },
        headers: data.headers,
      }

      const poller = await client.beginSend(message)
      const result = await poller.pollUntilDone()
      if (result.status !== 'Succeeded') {
        throw new Error(`Azure Communication Services failed with status: ${result.status}`)
      }
      return {
        success: true,
        message: 'Email sent successfully via Azure Communication Services',
        data: { id: result.id },
      }
    },
  }
}
