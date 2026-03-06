import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId } from '@/lib/core/security/input-validation'
import { getJiraCloudId, getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

const logger = createLogger('JsmSelectorServiceDesksAPI')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')
    const accessToken = searchParams.get('accessToken')

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    const cloudId = await getJiraCloudId(domain, accessToken)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudId)
    const url = `${baseUrl}/servicedesk?limit=100`

    const response = await fetch(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('JSM API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: `JSM API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    const serviceDesks = (data.values || []).map((sd: { id: string; projectName: string }) => ({
      id: sd.id,
      name: sd.projectName,
    }))

    return NextResponse.json({ serviceDesks })
  } catch (error) {
    logger.error('Error listing JSM service desks:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
}
