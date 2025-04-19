import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { domain, accessToken, issueKeys = [] } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (issueKeys.length === 0) {
      console.log('No issue keys provided, returning empty result')
      return NextResponse.json({ issues: [] })
    }

    // Log request details for debugging
    console.log('Request details:', {
      domain,
      tokenLength: accessToken ? accessToken.length : 0,
      issueKeysCount: issueKeys.length
    })

    // Build the URL for Jira API - using the bulkfetch endpoint
    const url = `https://${domain}/rest/api/3/issue/bulkfetch`
    
    console.log(`Fetching Jira issues from: ${url}`)

    // Prepare the request body for bulkfetch
    const requestBody = {
      expand: ["names"],
      fields: ["summary", "status", "assignee", "updated", "project"],
      fieldsByKeys: false,
      issueIdsOrKeys: issueKeys,
      properties: []
    }

    console.log("Request body:", {
      ...requestBody,
      issueIdsOrKeys: requestBody.issueIdsOrKeys.slice(0, 5) // Only log a few issue keys
    })

    // Make the request to Jira API with OAuth Bearer token
    const requestConfig = {
      method: 'POST', 
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }

    console.log('Making Jira API request with config:', {
      url,
      method: requestConfig.method,
      headers: {
        ...requestConfig.headers,
        'Authorization': 'Bearer [REDACTED]' // Don't log the actual token
      }
    })

    const response = await fetch(url, requestConfig)

    console.log('Response status:', response.status, response.statusText)

    if (!response.ok) {
      console.error(`Jira API error: ${response.status} ${response.statusText}`)
      let errorMessage

      try {
        const errorData = await response.json()
        console.error('Error details:', JSON.stringify(errorData, null, 2))
        errorMessage = errorData.message || `Failed to fetch Jira issues (${response.status})`
      } catch (e) {
        console.error('Could not parse error response as JSON:', e)

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
    console.log(`Found ${data.issues?.length || 0} issues`)

    if (data.issues && data.issues.length > 0) {
      console.log('First few issues:')
      data.issues.slice(0, 3).forEach((issue: any) => {
        console.log(`- ${issue.key}: ${issue.fields.summary}`)
      })
    }

    return NextResponse.json({
      issues: data.issues ? data.issues.map((issue: any) => ({
        id: issue.key,
        name: issue.fields.summary,
        mimeType: 'jira/issue',
        url: `https://${domain}/browse/${issue.key}`,
        modifiedTime: issue.fields.updated,
        webViewLink: `https://${domain}/browse/${issue.key}`,
      })) : [],
    })
  } catch (error) {
    console.error('Error fetching Jira issues:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const domain = url.searchParams.get('domain')
    const accessToken = url.searchParams.get('accessToken')
    const query = url.searchParams.get('query')
    
    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Build the URL for Jira Issue Picker API
    const apiUrl = `https://${domain}/rest/api/3/issue/picker?query=${encodeURIComponent(query)}`
    
    console.log(`Fetching Jira issue suggestions from: ${apiUrl}`)

    // Make the request to Jira API with OAuth Bearer token
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      console.error(`Jira API error: ${response.status} ${response.statusText}`)
      const errorMessage = `Failed to fetch issue suggestions: ${response.status} ${response.statusText}`
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching Jira issue suggestions:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}