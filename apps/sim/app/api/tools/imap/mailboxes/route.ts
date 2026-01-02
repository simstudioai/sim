import { createLogger } from '@sim/logger'
import { ImapFlow } from 'imapflow'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createLogger('ImapMailboxesAPI')

interface ImapMailboxRequest {
  host: string
  port: number
  secure: boolean
  rejectUnauthorized: boolean
  username: string
  password: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ImapMailboxRequest
    const { host, port, secure, rejectUnauthorized, username, password } = body

    if (!host || !username || !password) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields: host, username, password' },
        { status: 400 }
      )
    }

    const client = new ImapFlow({
      host,
      port: port || 993,
      secure: secure ?? true,
      auth: {
        user: username,
        pass: password,
      },
      tls: {
        rejectUnauthorized: rejectUnauthorized ?? true,
      },
      logger: false,
    })

    try {
      await client.connect()

      // List all mailboxes
      const listResult = await client.list()
      const mailboxes = listResult.map((mailbox) => ({
        path: mailbox.path,
        name: mailbox.name,
        delimiter: mailbox.delimiter,
      }))

      await client.logout()

      // Sort mailboxes: INBOX first, then alphabetically
      mailboxes.sort((a, b) => {
        if (a.path === 'INBOX') return -1
        if (b.path === 'INBOX') return 1
        return a.path.localeCompare(b.path)
      })

      return NextResponse.json({
        success: true,
        mailboxes,
      })
    } catch (error) {
      // Make sure to close connection on error
      try {
        await client.logout()
      } catch {
        // Ignore logout errors
      }
      throw error
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Error fetching IMAP mailboxes:', errorMessage)

    // Provide user-friendly error messages
    let userMessage = 'Failed to connect to IMAP server'
    if (
      errorMessage.includes('AUTHENTICATIONFAILED') ||
      errorMessage.includes('Invalid credentials')
    ) {
      userMessage = 'Invalid username or password. For Gmail, use an App Password.'
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
      userMessage = 'Could not find IMAP server. Please check the hostname.'
    } else if (errorMessage.includes('ECONNREFUSED')) {
      userMessage = 'Connection refused. Please check the port and SSL settings.'
    } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
      userMessage =
        'TLS/SSL error. Try disabling "Verify TLS Certificate" for self-signed certificates.'
    } else if (errorMessage.includes('timeout')) {
      userMessage = 'Connection timed out. Please check your network and server settings.'
    }

    return NextResponse.json({ success: false, message: userMessage }, { status: 500 })
  }
}
