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

    // Log request details for debugging
    console.log('Request details:', {
      domain,
      tokenLength: accessToken ? accessToken.length : 0,
      hasTitle: !!title,
      limit,
    })

    // Build the URL with query parameters
    const baseUrl = `https://${domain}/rest/api/2/search`
    const queryParams = new URLSearchParams()

    if (limit) {
      queryParams.append('maxResults', limit.toString())
    }

    if (title) {
      queryParams.append('title', title)
    }

    const queryString = queryParams.toString()
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl

    console.log(`Fetching Jira issues from: ${url}`)


    // Make the request to Jira API with OAuth Bearer token
    const requestConfig = {
      method: 'GET', 
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      }
    }

    console.log('Making Jira API request with config:', {
      url,
      method: requestConfig.method,
      headers: {
        ...requestConfig.headers,
        'Authorization': `Bearer ${accessToken}` // Don't log the actual token
      }
    })

    const response = await fetch(url, requestConfig)

    console.log('Response status:', response.status, response.statusText)

    if (!response.ok) {
        console.error(`Jira API error: ${response.status} ${response.statusText}`)
        let errorMessage

      try {
        console.log("Here is the response: ", response)
        const errorData = await response.json()
        console.error('Error details:', JSON.stringify(errorData, null, 2))
        errorMessage = errorData.message || `Failed to fetch Jira issues (${response.status})`
      } catch (e) {
        console.error('Could not parse error response as JSON:', e)

        // Try to get the response text for more context
        try {
          const text = await response.text()
          console.error('Response text:', text)
          errorMessage = `Failed to fetch Jira issues: ${response.status} ${response.statusText}`
        } catch (textError) {
          errorMessage = `Failed to fetch Jira issues: ${response.status} ${response.statusText}`
        }
      }

      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    console.log('Jira API response:', JSON.stringify(data, null, 2).substring(0, 300) + '...')
    console.log(`Found ${data.results?.length || 0} issues`)

    if (data.results && data.results.length > 0) {
      console.log('First few issues:')
      data.results.slice(0, 3).forEach((issue: any) => {
        console.log(`- ${issue.id}: ${issue.title}`)
      })
    }

    return NextResponse.json({
        issues: data.issues.map((issue: any) => ({
          id: issue.key,
          name: issue.fields.summary,
          mimeType: 'jira/issue',
          url: `https://${domain}/browse/${issue.key}`,
          modifiedTime: issue.fields.updated,
          webViewLink: `https://${domain}/browse/${issue.key}`,
        })),
      })
  } catch (error) {
    console.error('Error fetching Jira issues:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
