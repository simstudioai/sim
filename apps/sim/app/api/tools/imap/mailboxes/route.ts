import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ImapFlow } from 'imapflow'
import { type NextRequest, NextResponse } from 'next/server'
import { imapMailboxesContract } from '@/lib/api/contracts/tools/imap'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ImapMailboxesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(
    imapMailboxesContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          {
            success: false,
            message: getValidationErrorMessage(
              error,
              'Missing required fields: host, username, password'
            ),
          },
          { status: 400 }
        ),
      invalidJsonResponse: () =>
        NextResponse.json(
          { success: false, message: 'Request body must be valid JSON' },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response
  const { host, port, secure, username, password } = parsed.data.body

  try {
    const hostValidation = await validateDatabaseHost(host, 'host')
    if (!hostValidation.isValid) {
      return NextResponse.json({ success: false, message: hostValidation.error }, { status: 400 })
    }

    const client = new ImapFlow({
      host: hostValidation.resolvedIP!,
      servername: host,
      port,
      secure,
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
    const errorMessage = getErrorMessage(error, 'Unknown error')
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
