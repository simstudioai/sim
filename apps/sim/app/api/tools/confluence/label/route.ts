import { NextResponse } from 'next/server'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

export const dynamic = 'force-dynamic'

// Remove a label from a page
export async function DELETE(request: Request) {
  try {
    const {
      domain,
      accessToken,
      cloudId: providedCloudId,
      pageId,
      labelName,
    } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    if (!labelName) {
      return NextResponse.json({ error: 'Label name is required' }, { status: 400 })
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

    // First, get all labels to find the label ID
    const listUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/labels`
    const listResponse = await fetch(listUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!listResponse.ok) {
      throw new Error(`Failed to list labels: ${listResponse.status}`)
    }

    const listData = await listResponse.json()
    const label = (listData.results || []).find((l: any) => l.name === labelName)

    if (!label) {
      return NextResponse.json({ error: `Label "${labelName}" not found on page` }, { status: 404 })
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/labels/${label.id}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2),
      })
      const errorMessage =
        errorData?.message || `Failed to remove Confluence label (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    return NextResponse.json({ pageId, labelName, removed: true })
  } catch (error) {
    console.error('Error removing Confluence label:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
