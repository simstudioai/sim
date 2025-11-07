import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceAttachmentsAPI')

export const dynamic = 'force-dynamic'

// List attachments on a page
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')
    const accessToken = searchParams.get('accessToken')
    const pageId = searchParams.get('pageId')
    const providedCloudId = searchParams.get('cloudId')
    const limit = searchParams.get('limit') || '25'

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
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

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/attachments?limit=${limit}`

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      logger.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to list Confluence attachments (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    const attachments = (data.results || []).map((attachment: any) => ({
      id: attachment.id,
      title: attachment.title,
      fileSize: attachment.fileSize || 0,
      mediaType: attachment.mediaType || '',
      downloadUrl: attachment.downloadLink || attachment._links?.download || '',
    }))

    return NextResponse.json({ attachments })
  } catch (error) {
    logger.error('Error listing Confluence attachments:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
