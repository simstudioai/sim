import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { domain, accessToken, title, limit = 50 } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    // Build the URL with query parameters
    const baseUrl = `https://${domain}/wiki/api/v2/pages`
    const queryParams = new URLSearchParams()

    if (limit) {
      queryParams.append('limit', limit.toString())
    }

    if (title) {
      queryParams.append('title', title)
    }

    const queryString = queryParams.toString()
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl

    console.log(`Fetching Confluence pages from: ${url}`)

    // Make the request to Confluence API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      console.error(`Confluence API error: ${response.status} ${response.statusText}`)
      let errorMessage

      try {
        const errorData = await response.json()
        errorMessage = errorData.message || `Failed to fetch Confluence pages (${response.status})`
        console.error('Error details:', errorData)
      } catch (e) {
        errorMessage = `Failed to fetch Confluence pages: ${response.status} ${response.statusText}`
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    console.log('Confluence API response:', JSON.stringify(data, null, 2).substring(0, 300) + '...')
    console.log(`Found ${data.results?.length || 0} pages`)

    if (data.results && data.results.length > 0) {
      console.log('First few pages:')
      data.results.slice(0, 3).forEach((page: any) => {
        console.log(`- ${page.id}: ${page.title}`)
      })
    }

    return NextResponse.json({
      files: data.results.map((page: any) => ({
        id: page.id,
        name: page.title,
        mimeType: 'confluence/page',
        url: page._links?.webui || '',
        modifiedTime: page.version?.createdAt || '',
        spaceId: page.spaceId,
        webViewLink: page._links?.webui || '',
      })),
    })
  } catch (error) {
    console.error('Error fetching Confluence pages:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
