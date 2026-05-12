import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { gmailLabelsSelectorContract } from '@/lib/api/contracts/selectors/google'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getScopesForService } from '@/lib/oauth/utils'
import {
  getServiceAccountToken,
  refreshAccessTokenIfNeeded,
  ServiceAccountTokenError,
} from '@/app/api/auth/oauth/utils'
export const dynamic = 'force-dynamic'

const logger = createLogger('GmailLabelsAPI')

interface GmailLabel {
  id: string
  name: string
  type: 'system' | 'user'
  messagesTotal?: number
  messagesUnread?: number
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(gmailLabelsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, query } = parsed.data.query
    const impersonateEmail = parsed.data.query.impersonateEmail || undefined

    const credentialIdValidation = validateAlphanumericId(credentialId, 'credentialId', 255)
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credential ID: ${credentialIdValidation.error}`)
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedCredentialId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    let accessToken: string | null = null

    if (authz.credentialType === 'service_account') {
      accessToken = await getServiceAccountToken(
        authz.resolvedCredentialId,
        getScopesForService('gmail'),
        impersonateEmail
      )
    } else {
      accessToken = await refreshAccessTokenIfNeeded(
        credentialId,
        authz.credentialOwnerUserId,
        requestId,
        getScopesForService('gmail')
      )
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    logger.info(`[${requestId}] Gmail API response status: ${response.status}`)

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Gmail API error response: ${errorText}`)

      try {
        const error = JSON.parse(errorText)
        return NextResponse.json({ error }, { status: response.status })
      } catch (_e) {
        return NextResponse.json({ error: errorText }, { status: response.status })
      }
    }

    const data = await response.json()
    if (!Array.isArray(data.labels)) {
      logger.error(`[${requestId}] Unexpected labels response structure:`, data)
      return NextResponse.json({ error: 'Invalid labels response' }, { status: 500 })
    }

    const labels = data.labels.map((label: GmailLabel) => {
      let formattedName = label.name

      if (label.type === 'system') {
        formattedName = label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase()
      }

      return {
        id: label.id,
        name: formattedName,
        type: label.type,
        messagesTotal: label.messagesTotal || 0,
        messagesUnread: label.messagesUnread || 0,
      }
    })

    const filteredLabels = query
      ? labels.filter((label: GmailLabel) =>
          label.name.toLowerCase().includes((query as string).toLowerCase())
        )
      : labels

    return NextResponse.json({ labels: filteredLabels }, { status: 200 })
  } catch (error) {
    if (error instanceof ServiceAccountTokenError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error(`[${requestId}] Error fetching Gmail labels:`, error)
    return NextResponse.json({ error: 'Failed to fetch Gmail labels' }, { status: 500 })
  }
})
