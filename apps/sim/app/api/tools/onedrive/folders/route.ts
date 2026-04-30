import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { onedriveFoldersQuerySchema } from '@/lib/api/contracts/selectors/microsoft'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'
import type { MicrosoftGraphDriveItem } from '@/tools/onedrive/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFoldersAPI')

/**
 * Get folders from Microsoft OneDrive
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const validation = onedriveFoldersQuerySchema.safeParse({
      credentialId: searchParams.get('credentialId') ?? '',
      query: searchParams.get('query') ?? undefined,
    })
    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid folders request data`, {
        errors: validation.error.issues,
      })
      return NextResponse.json(
        { error: getValidationErrorMessage(validation.error, 'Invalid request') },
        { status: 400 }
      )
    }
    const { credentialId } = validation.data
    const query = validation.data.query ?? ''

    const credentialIdValidation = validateMicrosoftGraphId(credentialId, 'credentialId')
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credential ID`, { error: credentialIdValidation.error })
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
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
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const accountRow = credentials[0]

    const accessToken = await refreshAccessTokenIfNeeded(
      resolved.accountId,
      accountRow.userId,
      requestId
    )
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    let url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime&$top=50`

    if (query) {
      url += `&$search="${encodeURIComponent(query)}"`
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch folders from OneDrive' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const folders = (data.value || [])
      .filter((item: MicrosoftGraphDriveItem) => item.folder)
      .map((folder: MicrosoftGraphDriveItem) => ({
        id: folder.id,
        name: folder.name,
        mimeType: 'application/vnd.microsoft.graph.folder',
        webViewLink: folder.webUrl,
        createdTime: folder.createdDateTime,
        modifiedTime: folder.lastModifiedDateTime,
      }))

    return NextResponse.json({ files: folders }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching folders from OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
