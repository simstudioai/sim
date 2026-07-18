import { createLogger } from '@sim/logger'
import { JWT } from 'google-auth-library'
import MailComposer from 'nodemailer/lib/mail-composer'
import { env } from '@/lib/core/config/env'
import type { MailProvider, ProcessedEmailData, SendEmailResult } from '@/lib/messaging/email/types'

const logger = createLogger('GmailMailProvider')

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

/**
 * Media-upload variant of `users.messages.send` — accepts the raw RFC 822
 * message as the request body (up to ~35 MiB), so no base64url re-encoding
 * of the MIME payload is needed.
 */
const GMAIL_SEND_ENDPOINT =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media'

interface GmailServiceAccount {
  client_email: string
  private_key: string
}

function parseServiceAccount(credentialsJson: string): GmailServiceAccount | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(credentialsJson)
  } catch {
    logger.warn('GMAIL_CREDENTIALS_JSON is not valid JSON; skipping Gmail provider.')
    return null
  }

  const credentials = parsed as Partial<GmailServiceAccount>
  if (!credentials.client_email || !credentials.private_key) {
    logger.warn(
      'GMAIL_CREDENTIALS_JSON must contain client_email and private_key; skipping Gmail provider.'
    )
    return null
  }

  return credentials as GmailServiceAccount
}

/**
 * RFC 822 requires CRLF line endings throughout; MailComposer preserves
 * caller-supplied bare-LF endings inside html/text bodies, so normalize them.
 */
function normalizeCrlf(value: string | undefined): string | undefined {
  return value?.replace(/\r?\n/g, '\r\n')
}

/** Build the raw RFC 822 message via nodemailer's composer (multipart, attachments, headers). */
function buildRawMessage(data: ProcessedEmailData): Promise<Buffer> {
  const composer = new MailComposer({
    from: data.senderEmail,
    to: data.to,
    subject: data.subject,
    html: normalizeCrlf(data.html),
    text: normalizeCrlf(data.text),
    replyTo: data.replyTo,
    headers: Object.keys(data.headers).length > 0 ? data.headers : undefined,
    attachments: data.attachments?.map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
      contentDisposition: att.disposition || 'attachment',
    })),
  })

  return new Promise<Buffer>((resolve, reject) => {
    composer.compile().build((error, message) => {
      if (error) reject(error)
      else resolve(message)
    })
  })
}

/**
 * Gmail API via a service account with domain-wide delegation, impersonating
 * the Google Workspace user in `GMAIL_SENDER`. This is the Google-native
 * transactional mail path (GCP has no first-party SES/ACS equivalent); the
 * Workspace SMTP relay alternative works through the generic SMTP provider.
 */
export function createGmailProvider(): MailProvider | null {
  const sender = env.GMAIL_SENDER
  const credentialsJson = env.GMAIL_CREDENTIALS_JSON
  if (!sender && !credentialsJson) return null
  if (!sender || !credentialsJson) {
    logger.warn(
      'Gmail provider requires both GMAIL_SENDER and GMAIL_CREDENTIALS_JSON; skipping Gmail provider.'
    )
    return null
  }

  const serviceAccount = parseServiceAccount(credentialsJson)
  if (!serviceAccount) return null

  const jwtClient = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: [GMAIL_SEND_SCOPE],
    subject: sender,
  })

  return {
    name: 'gmail',
    async send(data: ProcessedEmailData): Promise<SendEmailResult> {
      const raw = await buildRawMessage(data)

      const { token } = await jwtClient.getAccessToken()
      if (!token) {
        throw new Error(
          'Failed to obtain a Gmail API access token – check GMAIL_CREDENTIALS_JSON and that domain-wide delegation is granted for the gmail.send scope.'
        )
      }

      const response = await fetch(GMAIL_SEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'message/rfc822',
        },
        // Buffer is a valid BodyInit at runtime; undici's types only admit ArrayBufferView
        body: raw as BodyInit,
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new Error(
          `Gmail API send failed: ${response.status} ${response.statusText}${errorBody ? ` – ${errorBody.slice(0, 500)}` : ''}`
        )
      }

      // Gmail accepted the message once the status is 2xx; a missing or
      // malformed body must not surface as a send failure, or the mailer's
      // fallback chain would deliver the same email again via another provider.
      const result = (await response.json().catch(() => ({}))) as { id?: string }
      return {
        success: true,
        message: 'Email sent successfully via Gmail',
        data: { id: result.id },
      }
    },
  }
}
