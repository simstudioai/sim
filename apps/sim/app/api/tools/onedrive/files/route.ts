import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onedriveFilesQuerySchema } from '@/lib/api/contracts/selectors/microsoft'
import { getValidationErrorMessage } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { MicrosoftGraphDriveItem } from '@/tools/onedrive/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFilesAPI')

/**
 * Get files (not folders) from Microsoft OneDrive
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)
  logger.info(`[${requestId}] OneDrive files request received`)

  try {
    const { searchParams } = new URL(request.url)
    const validation = onedriveFilesQuerySchema.safeParse({
      credentialId: searchParams.get('credentialId') ?? '',
      query: searchParams.get('query') ?? undefined,
    })
    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid files request data`, { errors: validation.error.issues })
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

    logger.info(`[${requestId}] Fetching credential`, { credentialId })

    const credAccess = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!credAccess.ok || !credAccess.credentialOwnerUserId) {
      logger.warn(`[${requestId}] Credential access denied`, { error: credAccess.error })
      return NextResponse.json({ error: credAccess.error || 'Unauthorized' }, { status: 401 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      credAccess.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // $filter is unsupported on the /children endpoint; use search when a query is present
    let url: string
    if (query) {
      const searchParams_new = new URLSearchParams()
      searchParams_new.append(
        '$select',
        'id,name,file,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
      )
      searchParams_new.append('$top', '50')
      url = `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(query)}')?${searchParams_new.toString()}`
    } else {
      const searchParams_new = new URLSearchParams()
      searchParams_new.append(
        '$select',
        'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
      )
      searchParams_new.append('$top', '50')
      url = `https://graph.microsoft.com/v1.0/me/drive/root/children?${searchParams_new.toString()}`
    }

    logger.info(`[${requestId}] Fetching files from Microsoft Graph`, { url })

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: response.status,
        error: errorData.error?.message || 'Failed to fetch files from OneDrive',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch files from OneDrive' },
        { status: response.status }
      )
    }

    const data = await response.json()
    logger.info(`[${requestId}] Received ${data.value?.length || 0} items from Microsoft Graph`)

    const files = (data.value || [])
      .filter((item: MicrosoftGraphDriveItem) => !!item.file && !item.folder)
      .map((file: MicrosoftGraphDriveItem) => ({
        id: file.id,
        name: file.name,
        mimeType: file.file?.mimeType || 'application/octet-stream',
        iconLink: file.thumbnails?.[0]?.small?.url,
        webViewLink: file.webUrl,
        thumbnailLink: file.thumbnails?.[0]?.medium?.url,
        createdTime: file.createdDateTime,
        modifiedTime: file.lastModifiedDateTime,
        size: file.size?.toString(),
        owners: file.createdBy
          ? [
              {
                displayName: file.createdBy.user?.displayName || 'Unknown',
                emailAddress: file.createdBy.user?.email || '',
              },
            ]
          : [],
      }))

    logger.info(`[${requestId}] Returning ${files.length} files`, {
      totalItems: data.value?.length || 0,
    })

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching files from OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
