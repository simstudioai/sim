import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { domain, accessToken, pageId } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    // Log request details for debugging
    console.log('Request details:', {
      domain,
      tokenLength: accessToken ? accessToken.length : 0,
      pageId,
    })

    // Build the URL - using the same format as retrieve.ts
    const url = `https://${domain}/wiki/api/v2/pages/${pageId}?expand=body.view`

    console.log(`Fetching Confluence page from: ${url}`)

    // Make the request to Confluence API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    console.log('Response status:', response.status, response.statusText)

    if (!response.ok) {
      console.error(`Confluence API error: ${response.status} ${response.statusText}`)
      let errorMessage

      try {
        const errorData = await response.json()
        console.error('Error details:', JSON.stringify(errorData, null, 2))
        errorMessage = errorData.message || `Failed to fetch Confluence page (${response.status})`
      } catch (e) {
        console.error('Could not parse error response as JSON:', e)

        // Try to get the response text for more context
        try {
          const text = await response.text()
          console.error('Response text:', text)
          errorMessage = `Failed to fetch Confluence page: ${response.status} ${response.statusText}`
        } catch (textError) {
          errorMessage = `Failed to fetch Confluence page: ${response.status} ${response.statusText}`
        }
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    console.log(`Successfully fetched page: ${data.id} - ${data.title}`)

    return NextResponse.json({
      file: {
        id: data.id,
        name: data.title,
        mimeType: 'confluence/page',
        url: data._links?.webui || '',
        modifiedTime: data.version?.createdAt || '',
        spaceId: data.spaceId,
        webViewLink: data._links?.webui || '',
        content: data.body?.view?.value || '',
      },
    })
  } catch (error) {
    console.error('Error fetching Confluence page:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
