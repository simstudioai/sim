import { NextResponse } from 'next/server'

// Add interface at the top of the file
interface JiraIssue {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  modifiedTime: string;
  webViewLink: string;
}

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
    const domain = url.searchParams.get('domain')?.trim()
    const accessToken = url.searchParams.get('accessToken')
    let query = url.searchParams.get('query') || ''
    
    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    // Get cloudId from accessible-resources
    const accessibleResourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    if (!accessibleResourcesRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch accessible resources' },
        { status: accessibleResourcesRes.status }
      )
    }

    const accessibleResources = await accessibleResourcesRes.json()
    const normalizedInput = `https://${domain}`.toLowerCase()
    const matchedResource = accessibleResources.find((r: any) => r.url.toLowerCase() === normalizedInput)

    if (!matchedResource) {
      return NextResponse.json(
        { error: 'Could not find matching Jira site for provided domain' },
        { status: 404 }
      )
    }

    const cloudId = matchedResource.id

    // Build query parameters
    const params = new URLSearchParams()
    
    // Only add query if it exists
    if (query) {
      params.append('query', query)
    }

    // Use the correct Jira Cloud OAuth endpoint structure
    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/picker?${params.toString()}`

    console.log(`Fetching Jira issue suggestions from: ${apiUrl}`)

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    console.log('Response status:', response.status, response.statusText)

    if (!response.ok) {
      console.error(`Jira API error: ${response.status} ${response.statusText}`)
      let errorMessage
      try {
        const errorData = await response.json()
        console.error('Error details:', errorData)
        errorMessage = errorData.message || `Failed to fetch issue suggestions (${response.status})`
      } catch (e) {
        errorMessage = `Failed to fetch issue suggestions: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    
    // Add detailed logging
    console.log('Jira API Response Status:', response.status)
    console.log('Response Data:', JSON.stringify(data, null, 2))
    
    // Log sections and issues if they exist
    if (data.sections) {
      console.log('Number of sections:', data.sections.length)
      data.sections.forEach((section: any, index: number) => {
        console.log(`Section ${index + 1}:`, {
          label: section.label,
          issueCount: section.issues?.length || 0
        })
        if (section.issues?.length > 0) {
          console.log('First issue in section:', section.issues[0])
        }
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching Jira issue suggestions:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}