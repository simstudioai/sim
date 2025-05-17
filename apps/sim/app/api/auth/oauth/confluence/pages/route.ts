import { NextResponse } from 'next/server'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const {
      domain,
      accessToken,
      title,
      cloudId: providedCloudId,
      limit = 50,
    } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || (await getConfluenceCloudId(domain, accessToken))

    // Build the URL with query parameters
    const baseUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages`
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

    // Make the request to Confluence API with OAuth Bearer token
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
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
        errorMessage = errorData.message || `Failed to fetch Confluence pages (${response.status})`
      } catch (e) {
        console.error('Could not parse error response as JSON:', e)

        // Try to get the response text for more context
        try {
          const text = await response.text()
          console.error('Response text:', text)
          errorMessage = `Failed to fetch Confluence pages: ${response.status} ${response.statusText}`
        } catch (textError) {
          errorMessage = `Failed to fetch Confluence pages: ${response.status} ${response.statusText}`
        }
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
