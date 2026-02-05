import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceUploadAttachmentAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { domain, accessToken, cloudId: providedCloudId, pageId, file, fileName, comment } = body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const pageIdValidation = validateAlphanumericId(pageId, 'pageId', 255)
    if (!pageIdValidation.isValid) {
      return NextResponse.json({ error: pageIdValidation.error }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    let fileToProcess = file
    if (Array.isArray(file)) {
      if (file.length === 0) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }
      fileToProcess = file[0]
    }

    let userFile
    try {
      userFile = processSingleFileToUserFile(fileToProcess, 'confluence-upload', logger)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to process file' },
        { status: 400 }
      )
    }

    let fileBuffer: Buffer
    try {
      fileBuffer = await downloadFileFromStorage(userFile, 'confluence-upload', logger)
    } catch (error) {
      logger.error('Failed to download file from storage:', error)
      return NextResponse.json(
        {
          error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        { status: 500 }
      )
    }

    const uploadFileName = fileName || userFile.name || 'attachment'
    const mimeType = userFile.type || 'application/octet-stream'

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/${pageId}/child/attachment`

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType })
    formData.append('file', blob, uploadFileName)

    if (comment) {
      formData.append('comment', comment)
    }

    // Add minorEdit field as required by Confluence API
    formData.append('minorEdit', 'false')

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Atlassian-Token': 'nocheck',
      },
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })

      let errorMessage = `Failed to upload attachment to Confluence (${response.status})`
      if (errorData?.message) {
        errorMessage = errorData.message
      } else if (errorData?.errorMessage) {
        errorMessage = errorData.errorMessage
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const attachment = data.results?.[0] || data

    return NextResponse.json({
      attachmentId: attachment.id,
      title: attachment.title,
      fileSize: attachment.extensions?.fileSize || 0,
      mediaType: attachment.extensions?.mediaType || mimeType,
      downloadUrl: attachment._links?.download || '',
      pageId: pageId,
    })
  } catch (error) {
    logger.error('Error uploading Confluence attachment:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
