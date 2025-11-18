import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { getCredential, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftFilesAPI')

/**
 * Get Excel files from Microsoft OneDrive
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const query = searchParams.get('query') || ''
    const workflowId = searchParams.get('workflowId') || undefined

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId,
      requireWorkflowIdForInternal: false,
    })

    if (!authz.ok || !authz.credentialOwnerUserId) {
      const status = authz.error === 'Credential not found' ? 404 : 403
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status })
    }

    const credential = await getCredential(requestId, credentialId, authz.credentialOwnerUserId)
    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    // Refresh access token if needed using the utility function
    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Build search query for Excel files
    let searchQuery = '.xlsx'
    if (query) {
      searchQuery = `${query} .xlsx`
    }

    // Build the query parameters for Microsoft Graph API
    const searchParams_new = new URLSearchParams()
    searchParams_new.append(
      '$select',
      'id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy'
    )
    searchParams_new.append('$top', '50')

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(searchQuery)}')?${searchParams_new.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: response.status,
        error: errorData.error?.message || 'Failed to fetch Excel files from Microsoft OneDrive',
      })
      return NextResponse.json(
        {
          error: errorData.error?.message || 'Failed to fetch Excel files from Microsoft OneDrive',
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    let files = data.value || []

    // Transform Microsoft Graph response to match expected format and filter for Excel files
    files = files
      .filter(
        (file: any) =>
          file.name?.toLowerCase().endsWith('.xlsx') ||
          file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      .map((file: any) => ({
        id: file.id,
        name: file.name,
        mimeType:
          file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    logger.error(`[${requestId}] Error fetching Excel files from Microsoft OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
