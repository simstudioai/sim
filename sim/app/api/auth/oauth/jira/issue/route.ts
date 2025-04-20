import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { domain, accessToken, issueId } = await request.json()

    console.log('Full request parameters:', {
        domain: domain,
        issueId: issueId,
        accessToken: accessToken ? `${accessToken.substring(0, 10)}...` : 'missing', // Only log part of token for security
        hasAccessToken: !!accessToken,
        tokenLength: accessToken?.length || 0,
        isDomainValid: !!domain && domain.includes('.'),
        isIssueIdValid: !!issueId
      })

    // Add detailed request logging
    console.log('Received request for Jira issue:', {
      domain: domain,
      issueId: issueId,
      hasAccessToken: !!accessToken
    })

    if (!domain) {
      console.error('Missing domain in request')
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      console.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!issueId) {
      console.error('Missing issue ID in request')
      return NextResponse.json({ error: 'Issue ID is required' }, { status: 400 })
    }

    // First, get the cloudId using accessible-resources
    const accessibleResourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    if (!accessibleResourcesRes.ok) {
      console.error('Failed to fetch accessible resources:', {
        status: accessibleResourcesRes.status,
        statusText: accessibleResourcesRes.statusText
      })
      return NextResponse.json(
        { error: 'Failed to fetch accessible resources' },
        { status: accessibleResourcesRes.status }
      )
    }

    const accessibleResources = await accessibleResourcesRes.json()
    console.log('Received accessible resources:', accessibleResources)

    const normalizedInput = `https://${domain}`.toLowerCase()
    const matchedResource = accessibleResources.find((r: any) => 
      r.url.toLowerCase() === normalizedInput
    )

    if (!matchedResource) {
      console.error('No matching Jira site found for domain:', domain)
      return NextResponse.json(
        { error: 'Could not find matching Jira site for provided domain' },
        { status: 404 }
      )
    }

    const cloudId = matchedResource.id
    console.log('Found cloud ID:', cloudId)

    // Build the URL using cloudId for Jira API
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueId}`
    
    console.log('Fetching Jira issue from:', url)

    // Make the request to Jira API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      console.error('Jira API error:', {
        status: response.status,
        statusText: response.statusText
      })
      
      let errorMessage
      try {
        const errorData = await response.json()
        console.error('Error details:', errorData)
        errorMessage = errorData.message || `Failed to fetch issue (${response.status})`
      } catch (e) {
        errorMessage = `Failed to fetch issue: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    console.log('Received Jira issue data:', {
      key: data.key,
      summary: data.fields?.summary,
      status: data.fields?.status?.name
    })
    
    // Transform the Jira issue data into our expected format
    const issueInfo: any = {
      id: data.key,
      name: data.fields.summary,
      mimeType: 'jira/issue',
      url: `https://${domain}/browse/${data.key}`,
      modifiedTime: data.fields.updated,
      webViewLink: `https://${domain}/browse/${data.key}`,
      // Add additional fields that might be needed for the workflow
      status: data.fields.status?.name,
      description: data.fields.description,
      priority: data.fields.priority?.name,
      assignee: data.fields.assignee?.displayName,
      reporter: data.fields.reporter?.displayName,
      project: {
        key: data.fields.project?.key,
        name: data.fields.project?.name
      }
    }

    console.log('Successfully transformed issue data:', {
      id: issueInfo.id,
      name: issueInfo.name,
      status: issueInfo.status
    })

    return NextResponse.json({
      issue: issueInfo
    })

  } catch (error) {
    console.error('Error processing request:', error)
    // Add more context to the error response
    return NextResponse.json(
      { 
        error: 'Failed to retrieve Jira issue',
        details: (error as Error).message,
        stack: (error as Error).stack
      },
      { status: 500 }
    )
  }
}
