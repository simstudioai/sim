import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftFilesQuerySchema } from '@/lib/api/contracts/selectors/microsoft'
import { getValidationErrorMessage } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validatePathSegment } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredential, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { GRAPH_ID_PATTERN } from '@/tools/microsoft_excel/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftFilesAPI')

/**
 * Microsoft Graph paginates `search()` results via the `@odata.nextLink`
 * absolute URL in the response body. Request the largest page (`$top` caps at
 * 999) and drain following nextLink, bounded by a page cap.
 * See https://learn.microsoft.com/en-us/graph/paging
 */
const MICROSOFT_FILES_PAGE_SIZE = 999
const MAX_MICROSOFT_FILES_PAGES = 20

interface MicrosoftGraphFile {
  id: string
  name?: string
  mimeType?: string
  webUrl?: string
  size?: number
  createdDateTime?: string
  lastModifiedDateTime?: string
  thumbnails?: Array<{ small?: { url?: string }; medium?: { url?: string } }>
  createdBy?: { user?: { displayName?: string; email?: string } }
}

/**
 * The shared `/api/auth/oauth/microsoft/files` route serves both the
 * `microsoft.excel` and `microsoft.word` selectors. The two are distinguished
 * by the `fileType` query parameter the selector forwards (defaulting to
 * `excel` for backward compatibility), which drives both the search-query
 * extension hint and the server-side result filter.
 */
const FILE_TYPE_CONFIG = {
  excel: {
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  word: {
    extension: '.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
} as const

type MicrosoftFileType = keyof typeof FILE_TYPE_CONFIG

/**
 * Get Excel or Word files from Microsoft OneDrive / SharePoint. The
 * `fileType` query parameter selects which Office document type to return
 * (defaults to `excel`).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const parsedQuery = microsoftFilesQuerySchema.safeParse({
      credentialId: searchParams.get('credentialId') ?? undefined,
      query: searchParams.get('query') ?? undefined,
      driveId: searchParams.get('driveId') ?? undefined,
      workflowId: searchParams.get('workflowId') ?? undefined,
      fileType: searchParams.get('fileType') ?? undefined,
    })

    if (!parsedQuery.success) {
      logger.warn(`[${requestId}] Invalid query parameters`)
      return NextResponse.json(
        { error: getValidationErrorMessage(parsedQuery.error) },
        { status: 400 }
      )
    }

    const { credentialId, driveId, workflowId } = parsedQuery.data
    const query = parsedQuery.data.query ?? ''

    const fileType: MicrosoftFileType = parsedQuery.data.fileType ?? 'excel'
    const { extension, mimeType: targetMimeType } = FILE_TYPE_CONFIG[fileType]

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId,
      requireWorkflowIdForInternal: false,
    })

    if (!authz.ok || !authz.credentialOwnerUserId) {
      const status = authz.error === 'Credential not found' ? 404 : 403
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status })
    }

    const resolvedCredentialId = authz.resolvedCredentialId || credentialId
    const credential = await getCredential(
      requestId,
      resolvedCredentialId,
      authz.credentialOwnerUserId
    )
    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    // Refresh access token if needed using the utility function
    const accessToken = await refreshAccessTokenIfNeeded(
      resolvedCredentialId,
      authz.credentialOwnerUserId,
      requestId
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Build search query for the requested Office document type
    const searchQuery = query ? `${query} ${extension}` : extension

    // Build the query parameters for Microsoft Graph API
    const searchParams_new = new URLSearchParams()
    searchParams_new.append(
      '$select',
      'id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy'
    )
    searchParams_new.append('$top', String(MICROSOFT_FILES_PAGE_SIZE))

    // When driveId is provided (SharePoint), search within that specific drive.
    // Otherwise, search the user's personal OneDrive.
    if (driveId) {
      const driveIdValidation = validatePathSegment(driveId, {
        paramName: 'driveId',
        customPattern: GRAPH_ID_PATTERN,
      })
      if (!driveIdValidation.isValid) {
        return NextResponse.json({ error: driveIdValidation.error }, { status: 400 })
      }
    }
    const drivePath = driveId ? `drives/${driveId}` : 'me/drive'

    const rawFiles: MicrosoftGraphFile[] = []
    let nextUrl: string | undefined =
      `https://graph.microsoft.com/v1.0/${drivePath}/root/search(q='${encodeURIComponent(searchQuery)}')?${searchParams_new.toString()}`

    for (let page = 0; page < MAX_MICROSOFT_FILES_PAGES && nextUrl; page++) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: { message: 'Unknown error' } }))
        logger.error(`[${requestId}] Microsoft Graph API error`, {
          status: response.status,
          error: errorData.error?.message || 'Failed to fetch files from Microsoft OneDrive',
        })
        return NextResponse.json(
          {
            error: errorData.error?.message || 'Failed to fetch files from Microsoft OneDrive',
          },
          { status: response.status }
        )
      }

      const data = await response.json()
      rawFiles.push(...((data.value as MicrosoftGraphFile[]) || []))

      const nextLink = getGraphNextPageUrl(data)
      nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined

      if (nextUrl && page === MAX_MICROSOFT_FILES_PAGES - 1) {
        logger.warn(
          `[${requestId}] Microsoft files search hit pagination cap; list may be incomplete`,
          { fileType, pages: MAX_MICROSOFT_FILES_PAGES, collected: rawFiles.length }
        )
      }
    }

    // Transform Microsoft Graph response and filter to the requested file type
    const files = rawFiles
      .filter(
        (file: MicrosoftGraphFile) =>
          file.name?.toLowerCase().endsWith(extension) || file.mimeType === targetMimeType
      )
      .map((file: MicrosoftGraphFile) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType || targetMimeType,
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

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching files from Microsoft OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
