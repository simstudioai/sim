import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/security/input-validation'
import { getJiraCloudId } from '@/tools/jira/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('JiraProjectsAPI')

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const domain = url.searchParams.get('domain')?.trim()
    const accessToken = url.searchParams.get('accessToken')
    const providedCloudId = url.searchParams.get('cloudId')
    const query = url.searchParams.get('query') || ''

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))
    logger.info(`Using cloud ID: ${cloudId}`)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/search`

    const queryParams = new URLSearchParams()
    if (query) {
      queryParams.append('query', query)
    }
    queryParams.append('orderBy', 'name')
    queryParams.append('expand', 'description,lead,url,projectKeys')

    const finalUrl = `${apiUrl}?${queryParams.toString()}`
    logger.info(`Fetching Jira projects from: ${finalUrl}`)

    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    logger.info(`Response status: ${response.status} ${response.statusText}`)

    if (!response.ok) {
      logger.error(`Jira API error: ${response.status} ${response.statusText}`)
      let errorMessage
      try {
        const errorData = await response.json()
        logger.error('Error details:', errorData)
        errorMessage = errorData.message || `Failed to fetch projects (${response.status})`
      } catch (_e) {
        errorMessage = `Failed to fetch projects: ${response.status} ${response.statusText}`
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status })
    }

    const data = await response.json()

    logger.info(`Jira API Response Status: ${response.status}`)
    logger.info(`Found projects: ${data.values?.length || 0}`)

    const projects =
      data.values?.map((project: any) => ({
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
      })) || []

    return NextResponse.json({
      projects,
      cloudId,
    })
  } catch (error) {
    logger.error('Error fetching Jira projects:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}

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

    const cloudId = providedCloudId || (await getJiraCloudId(domain, accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const projectIdValidation = validateAlphanumericId(projectId, 'projectId', 100)
    if (!projectIdValidation.isValid) {
      return NextResponse.json({ error: projectIdValidation.error }, { status: 400 })
    }

    const apiUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${projectId}`

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('Error details:', errorData)
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
      cloudId,
    })
  } catch (error) {
    logger.error('Error fetching Jira project:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
