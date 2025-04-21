import { NextResponse } from 'next/server'
import { getJiraCloudId } from '@/tools/jira/utils'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const domain = url.searchParams.get('domain')?.trim()
    const accessToken = url.searchParams.get('accessToken')
    const providedCloudId = url.searchParams.get('cloudId')
    let query = url.searchParams.get('query') || ''
    
    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || await getJiraCloudId(domain, accessToken)
    console.log('Using cloud ID:', cloudId)

    // Build the URL for the Jira API projects endpoint
    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`
    
    // Add query parameters if searching
    const queryParams = new URLSearchParams()
    if (query) {
      queryParams.append('query', query)
    }
    // Add other useful parameters
    queryParams.append('orderBy', 'name')
    queryParams.append('expand', 'description,lead,url,projectKeys')
    
    const finalUrl = `${apiUrl}?${queryParams.toString()}`
    console.log(`Fetching Jira projects from: ${finalUrl}`)

    const response = await fetch(finalUrl, {
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
        errorMessage = errorData.message || `Failed to fetch projects (${response.status})`
      } catch (e) {
        errorMessage = `Failed to fetch projects: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()
    
    // Add detailed logging
    console.log('Jira API Response Status:', response.status)
    console.log('Found projects:', data.values?.length || 0)

    // Transform the response to match our expected format
    const projects = data.values?.map((project: any) => ({
      id: project.id,
      key: project.key,
      name: project.name,
      url: project.self,
      avatarUrl: project.avatarUrls?.['48x48'], // Use the medium size avatar
      description: project.description,
      projectTypeKey: project.projectTypeKey,
      simplified: project.simplified,
      style: project.style,
      isPrivate: project.isPrivate,
    })) || []

    return NextResponse.json({
      projects,
      cloudId // Return the cloudId so it can be cached
    })
  } catch (error) {
    console.error('Error fetching Jira projects:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// For individual project retrieval if needed
export async function POST(request: Request) {
  try {
    const { domain, accessToken, projectId, cloudId: providedCloudId } = await request.json()

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    // Use provided cloudId or fetch it if not provided
    const cloudId = providedCloudId || await getJiraCloudId(domain, accessToken)
    console.log('Using cloud ID:', cloudId)

    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${projectId}`
    console.log(`Fetching Jira project from: ${apiUrl}`)

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('Error details:', errorData)
      return NextResponse.json(
        { error: errorData.message || `Failed to fetch project (${response.status})` },
        { status: response.status }
      )
    }

    const project = await response.json()

    return NextResponse.json({
      project: {
        id: project.id,
        key: project.key,
        name: project.name,
        url: project.self,
        avatarUrl: project.avatarUrls?.['48x48'],
        description: project.description,
        projectTypeKey: project.projectTypeKey,
        simplified: project.simplified,
        style: project.style,
        isPrivate: project.isPrivate,
      },
      cloudId
    })
  } catch (error) {
    console.error('Error fetching Jira project:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
