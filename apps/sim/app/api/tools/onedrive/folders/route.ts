import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onedriveFoldersQuerySchema } from '@/lib/api/contracts/selectors/microsoft'
import { getValidationErrorMessage } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { MicrosoftGraphDriveItem } from '@/tools/onedrive/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFoldersAPI')

/**
 * Microsoft Graph paginates drive item collections via the `@odata.nextLink`
 * absolute URL in the response body. Request the largest page (`$top` caps at
 * 999) and drain following nextLink, bounded by a page cap.
 * See https://learn.microsoft.com/en-us/graph/paging
 */
const ONEDRIVE_FOLDERS_PAGE_SIZE = 999
const MAX_ONEDRIVE_FOLDERS_PAGES = 20

/**
 * Get folders from Microsoft OneDrive
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
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

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedCredentialId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    let url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime&$top=${ONEDRIVE_FOLDERS_PAGE_SIZE}`

    if (query) {
      url += `&$search="${encodeURIComponent(query)}"`
    }

    const rawItems: MicrosoftGraphDriveItem[] = []
    let nextUrl: string | undefined = url

    for (let page = 0; page < MAX_ONEDRIVE_FOLDERS_PAGES && nextUrl; page++) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: 'Unknown error' } }))
        return NextResponse.json(
          { error: errorData.error?.message || 'Failed to fetch folders from OneDrive' },
          { status: response.status }
        )
      }

      const data = await response.json()
      rawItems.push(...((data.value as MicrosoftGraphDriveItem[]) || []))

      const nextLink = getGraphNextPageUrl(data)
      nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined

      if (nextUrl && page === MAX_ONEDRIVE_FOLDERS_PAGES - 1) {
        logger.warn(`[${requestId}] OneDrive folders hit pagination cap; list may be incomplete`, {
          pages: MAX_ONEDRIVE_FOLDERS_PAGES,
          collected: rawItems.length,
        })
      }
    }

    const folders = rawItems
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
