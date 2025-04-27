import { NextResponse } from 'next/server'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

export async function POST(request: Request) {
  try {
    const { domain, accessToken, pageId, cloudId: providedCloudId } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || await getConfluenceCloudId(domain, accessToken)

    // Build the URL for the Confluence API
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}?expand=body.storage,body.view,body.atlas_doc_format`


    // Make the request to Confluence API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      console.error(`Confluence API error: ${response.status} ${response.statusText}`)
      let errorMessage

      try {
        const errorData = await response.json()
        console.error('Error details:', JSON.stringify(errorData, null, 2))
        errorMessage = errorData.message || `Failed to fetch Confluence page (${response.status})`
      } catch (e) {
        console.error('Could not parse error response as JSON:', e)
        errorMessage = `Failed to fetch Confluence page: ${response.status} ${response.statusText}`
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    // If body is empty, try to provide a minimal valid response
    return NextResponse.json({
      id: data.id,
      title: data.title,
      body: {
        view: {
          value: data.body?.storage?.value || 
                data.body?.view?.value || 
                data.body?.atlas_doc_format?.value || 
                data.content || // try alternative fields
                data.description ||
                `Content for page ${data.title}` // fallback content
        }
      }
    })

  } catch (error) {
    console.error('Error fetching Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()

    const { 
      domain, 
      accessToken, 
      pageId, 
      cloudId: providedCloudId,
      title,
      body: pageBody,
      version 
    } = body

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || await getConfluenceCloudId(domain, accessToken)

    // First, get the current page to check its version
    const currentPageUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}`
    const currentPageResponse = await fetch(currentPageUrl, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      }
    })

    if (!currentPageResponse.ok) {
      throw new Error(`Failed to fetch current page: ${currentPageResponse.status}`)
    }

    const currentPage = await currentPageResponse.json()
    const currentVersion = currentPage.version.number

    // Build the update body with incremented version
    const updateBody: any = {
      id: pageId,
      version: {
        number: currentVersion + 1,
        message: version?.message || 'Updated via API'
      },
      title: title,
      body: {
        representation: 'storage',
        value: pageBody?.value || ''
      },
      status: 'current'
    }

    const response = await fetch(currentPageUrl, {
      method: 'PUT',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(updateBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('Confluence API error response:', {
        status: response.status,
        statusText: response.statusText,
        error: JSON.stringify(errorData, null, 2)
      })
      const errorMessage = errorData?.message || 
                         (errorData?.errors && JSON.stringify(errorData.errors)) || 
                         `Failed to update Confluence page (${response.status})`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error updating Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
