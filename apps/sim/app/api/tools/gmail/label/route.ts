import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailLabelAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated label request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const labelId = searchParams.get('labelId')

    if (!credentialId || !labelId) {
      logger.warn(`[${requestId}] Missing required parameters`)
      return NextResponse.json(
        { error: 'Credential ID and Label ID are required' },
        { status: 400 }
      )
    }

    const labelIdValidation = validateAlphanumericId(labelId, 'labelId', 255)
    if (!labelIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid label ID: ${labelIdValidation.error}`)
      return NextResponse.json({ error: labelIdValidation.error }, { status: 400 })
    }

    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    if (resolved.workspaceId) {
      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      const perm = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        resolved.workspaceId
      )
      if (perm === null) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const credentials = await db
      .select()
      .from(account)
      .where(eq(account.id, resolved.accountId))
      .limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`)
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const accountRow = credentials[0]

    logger.info(
      `[${requestId}] Using credential: ${accountRow.id}, provider: ${accountRow.providerId}`
    )

    const accessToken = await refreshAccessTokenIfNeeded(
      resolved.accountId,
      accountRow.userId,
      requestId
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    logger.info(`[${requestId}] Fetching label ${labelId} from Gmail API`)
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/labels/${labelId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

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

    const label = await response.json()

    let formattedName = label.name

    if (label.type === 'system') {
      formattedName = label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase()
    }

    const formattedLabel = {
      id: label.id,
      name: formattedName,
      type: label.type,
      messagesTotal: label.messagesTotal || 0,
      messagesUnread: label.messagesUnread || 0,
    }

    return NextResponse.json({ label: formattedLabel }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Gmail label:`, error)
    return NextResponse.json({ error: 'Failed to fetch Gmail label' }, { status: 500 })
  }
}
