import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { outlookFoldersSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookFoldersAPI')

interface OutlookFolder {
  id: string
  displayName: string
  totalItemCount?: number
  unreadItemCount?: number
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(outlookFoldersSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId } = parsed.data.query

    const credentialIdValidation = validateAlphanumericId(credentialId, 'credentialId')
    if (!credentialIdValidation.isValid) {
      logger.warn('Invalid credentialId format', { error: credentialIdValidation.error })
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    try {
      const credAccess = await authorizeCredentialUse(request, {
        credentialId,
        requireWorkflowIdForInternal: false,
      })
      if (!credAccess.ok || !credAccess.credentialOwnerUserId) {
        logger.warn('Credential access denied', { error: credAccess.error })
        return NextResponse.json(
          { error: credAccess.error || 'Authentication required' },
          { status: 401 }
        )
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credentialId,
        credAccess.credentialOwnerUserId,
        generateRequestId()
      )

      if (!accessToken) {
        logger.error('Failed to get access token', {
          credentialId,
          userId: credAccess.credentialOwnerUserId,
        })
        return NextResponse.json(
          {
            error: 'Could not retrieve access token',
            authRequired: true,
          },
          { status: 401 }
        )
      }

      const response = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Microsoft Graph API error getting folders', {
          status: response.status,
          error: errorData,
          endpoint: 'https://graph.microsoft.com/v1.0/me/mailFolders',
        })

        if (response.status === 401) {
          return NextResponse.json(
            {
              error: 'Authentication failed. Please reconnect your Outlook account.',
              authRequired: true,
            },
            { status: 401 }
          )
        }

        throw new Error(`Microsoft Graph API error: ${JSON.stringify(errorData)}`)
      }

      const data = await response.json()
      const folders = data.value || []

      const transformedFolders = folders.map((folder: OutlookFolder) => ({
        id: folder.id,
        name: folder.displayName,
        type: 'folder',
        messagesTotal: folder.totalItemCount || 0,
        messagesUnread: folder.unreadItemCount || 0,
      }))

      return NextResponse.json({
        folders: transformedFolders,
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)

      const errorMessage = toError(innerError).message
      if (
        errorMessage.includes('auth') ||
        errorMessage.includes('token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('unauthenticated')
      ) {
        return NextResponse.json(
          {
            error: 'Authentication failed. Please reconnect your Outlook account.',
            authRequired: true,
            details: errorMessage,
          },
          { status: 401 }
        )
      }

      throw innerError
    }
  } catch (error) {
    logger.error('Error processing Outlook folders request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Outlook folders',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
})
