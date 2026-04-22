import { createLogger } from '@sim/logger'
import { ImapFlow } from 'imapflow'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ImapMailboxesAPI')

interface ImapMailboxRequest {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as ImapMailboxRequest
    const { host, port, secure, username, password } = body

    if (!host || !username || !password) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields: host, username, password' },
        { status: 400 }
      )
    }

    const hostValidation = await validateDatabaseHost(host, 'host')
    if (!hostValidation.isValid) {
      return NextResponse.json({ success: false, message: hostValidation.error }, { status: 400 })
    }

    const client = new ImapFlow({
      host: hostValidation.resolvedIP!,
      servername: host,
      port: port || 993,
      secure: secure ?? true,
      auth: {
        user: username,
        pass: password,
      },
      tls: {
        rejectUnauthorized: true,
      },
      logger: false,
    })

    try {
      await client.connect()

      const listResult = await client.list()
      const mailboxes = listResult.map((mailbox) => ({
        path: mailbox.path,
        name: mailbox.name,
        delimiter: mailbox.delimiter,
      }))

      await client.logout()

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

    let userMessage = 'Failed to connect to IMAP server. Please check your connection settings.'
    if (
      errorMessage.includes('AUTHENTICATIONFAILED') ||
      errorMessage.includes('Invalid credentials')
    ) {
      userMessage = 'Invalid username or password. For Gmail, use an App Password.'
    }

    return NextResponse.json({ success: false, message: userMessage }, { status: 500 })
  }
})
