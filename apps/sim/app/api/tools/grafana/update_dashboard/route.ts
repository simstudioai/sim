import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { grafanaUpdateDashboardContract } from '@/lib/api/contracts/tools/grafana'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('GrafanaUpdateDashboardAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Grafana update dashboard attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      grafanaUpdateDashboardContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const baseUrl = params.baseUrl.replace(/\/$/, '')

    const getHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      getHeaders['X-Grafana-Org-Id'] = params.organizationId
    }

    const getUrl = `${baseUrl}/api/dashboards/uid/${params.dashboardUid.trim()}`
    const getValidation = await validateUrlWithDNS(getUrl, 'baseUrl')
    if (!getValidation.isValid || !getValidation.resolvedIP) {
      return NextResponse.json({
        success: false,
        output: {},
        error: `Invalid Grafana baseUrl: ${getValidation.error}`,
      })
    }

    const getResponse = await secureFetchWithPinnedIP(getUrl, getValidation.resolvedIP, {
      method: 'GET',
      headers: getHeaders,
    })

    if (!getResponse.ok) {
      const errorText = await getResponse.text()
      return NextResponse.json({
        success: false,
        output: {},
        error: `Failed to fetch existing dashboard: ${errorText}`,
      })
    }

    const existing = (await getResponse.json()) as any
    const existingDashboard = existing.dashboard
    const existingMeta = existing.meta

    if (!existingDashboard || !existingDashboard.uid) {
      return NextResponse.json({
        success: false,
        output: {},
        error: 'Failed to fetch existing dashboard',
      })
    }

    const updatedDashboard: Record<string, any> = {
      ...existingDashboard,
    }

    if (params.title) updatedDashboard.title = params.title
    if (params.timezone) updatedDashboard.timezone = params.timezone
    if (params.refresh) updatedDashboard.refresh = params.refresh

    if (params.tags) {
      updatedDashboard.tags = params.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t)
    }

    if (params.panels) {
      try {
        updatedDashboard.panels = JSON.parse(params.panels)
      } catch {
        return NextResponse.json({
          success: false,
          output: {},
          error: 'Invalid JSON for panels parameter',
        })
      }
    }

    if (existingDashboard.version) {
      updatedDashboard.version = existingDashboard.version
    }

    const body: Record<string, any> = {
      dashboard: updatedDashboard,
      overwrite: params.overwrite === true,
    }

    if (params.folderUid) {
      body.folderUid = params.folderUid
    } else if (existingMeta?.folderUid) {
      body.folderUid = existingMeta.folderUid
    }

    if (params.message) {
      body.message = params.message
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      headers['X-Grafana-Org-Id'] = params.organizationId
    }

    const updateUrl = `${baseUrl}/api/dashboards/db`
    const urlValidation = await validateUrlWithDNS(updateUrl, 'baseUrl')
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return NextResponse.json({
        success: false,
        output: {},
        error: `Invalid Grafana baseUrl: ${urlValidation.error}`,
      })
    }

    const updateResponse = await secureFetchWithPinnedIP(updateUrl, urlValidation.resolvedIP, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      return NextResponse.json({
        success: false,
        output: {},
        error: `Failed to update dashboard: ${errorText}`,
      })
    }

    const data = (await updateResponse.json()) as {
      id?: number
      uid?: string
      url?: string
      status?: string
      version?: number
      slug?: string
    }

    return NextResponse.json({
      success: true,
      output: {
        id: data.id,
        uid: data.uid,
        url: data.url,
        status: data.status,
        version: data.version,
        slug: data.slug,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating Grafana dashboard:`, error)
    return NextResponse.json({
      success: false,
      output: {},
      error: getErrorMessage(error),
    })
  }
})
