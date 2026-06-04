import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { onedriveFolderQuerySchema } from '@/lib/api/contracts/selectors/microsoft'
import { getValidationErrorMessage } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFolderAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const { searchParams } = new URL(request.url)
    const validation = onedriveFolderQuerySchema.safeParse({
      credentialId: searchParams.get('credentialId') ?? '',
      fileId: searchParams.get('fileId') ?? '',
    })
    if (!validation.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(validation.error, 'Invalid request') },
        { status: 400 }
      )
    }
    const { credentialId, fileId } = validation.data

    const fileIdValidation = validateMicrosoftGraphId(fileId, 'fileId')
    if (!fileIdValidation.isValid) {
      return NextResponse.json({ error: fileIdValidation.error }, { status: 400 })
    }

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
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}?$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch folder from OneDrive' },
        { status: response.status }
      )
    }

    const folder = await response.json()

    const transformedFolder = {
      id: folder.id,
      name: folder.name,
      mimeType: 'application/vnd.microsoft.graph.folder',
      webViewLink: folder.webUrl,
      createdTime: folder.createdDateTime,
      modifiedTime: folder.lastModifiedDateTime,
    }

    return NextResponse.json({ file: transformedFolder }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching folder from OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
