import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ImapFlow } from 'imapflow'
import { type NextRequest, NextResponse } from 'next/server'
import {
  imapMailboxesContract,
  resolvedImapMailboxesBodySchema,
} from '@/lib/api/contracts/tools/imap'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authenticateSelectorRequest,
  resolveAuthorizedSelectorContext,
} from '@/lib/selectors/server/resolve-authorized-context'

const logger = createLogger('ImapMailboxesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authentication = await authenticateSelectorRequest(request)
  if (!authentication.ok) {
    return NextResponse.json({ error: authentication.error }, { status: authentication.status })
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
  const { workflowId, ...context } = parsed.data.body

  const resolution = await resolveAuthorizedSelectorContext(authentication.principal, {
    workflowId,
    context,
  })
  if (!resolution.ok) {
    return NextResponse.json(
      { success: false, message: resolution.error },
      { status: resolution.status }
    )
  }
  const validated = resolvedImapMailboxesBodySchema.safeParse(resolution.context)
  if (!validated.success) {
    return NextResponse.json(
      { success: false, message: 'Invalid IMAP selector configuration' },
      { status: 400 }
    )
  }
  const { host, port, secure, username, password } = validated.data

  try {
    const hostValidation = await validateDatabaseHost(host, 'host', { logFailureDetails: false })
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
    logger.error('Error fetching IMAP mailboxes')
    const errorMessage = getErrorMessage(error)
    const userMessage =
      errorMessage.includes('AUTHENTICATIONFAILED') || errorMessage.includes('Invalid credentials')
        ? 'Invalid username or password. For Gmail, use an App Password.'
        : 'Failed to connect to IMAP server. Please check your connection settings.'
    return NextResponse.json(
      {
        success: false,
        message: userMessage,
      },
      { status: 500 }
    )
  }
})
