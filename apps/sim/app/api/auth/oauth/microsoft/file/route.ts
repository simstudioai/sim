import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { getCredential, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftFileAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const fileId = searchParams.get('fileId')
    const workflowId = searchParams.get('workflowId') || undefined

    if (!credentialId || !fileId) {
      return NextResponse.json({ error: 'Credential ID and File ID are required' }, { status: 400 })
    }

    const fileIdValidation = validateMicrosoftGraphId(fileId, 'fileId')
    if (!fileIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid file ID: ${fileIdValidation.error}`)
      return NextResponse.json({ error: fileIdValidation.error }, { status: 400 })
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

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}?$select=id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy`,
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
        error: errorData.error?.message || 'Failed to fetch file from Microsoft OneDrive',
      })
      return NextResponse.json(
        {
          error: errorData.error?.message || 'Failed to fetch file from Microsoft OneDrive',
        },
        { status: response.status }
      )
    }

    const file = await response.json()

    const transformedFile = {
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
      downloadUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/content`,
    }

    return NextResponse.json({ file: transformedFile }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching file from Microsoft OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
