import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { grafanaUpdateAlertRuleContract } from '@/lib/api/contracts/tools/grafana'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { mapAlertRule } from '@/tools/grafana/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GrafanaUpdateAlertRuleAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(
        `[${requestId}] Unauthorized Grafana update alert rule attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      grafanaUpdateAlertRuleContract,
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

    const getUrl = `${baseUrl}/api/v1/provisioning/alert-rules/${params.alertRuleUid.trim()}`
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
        error: `Failed to fetch existing alert rule: ${errorText}`,
      })
    }

    const existingRule = (await getResponse.json()) as any

    if (!existingRule || !existingRule.uid) {
      return NextResponse.json({
        success: false,
        output: {},
        error: 'Failed to fetch existing alert rule',
      })
    }

    const updatedRule: Record<string, unknown> = {
      ...existingRule,
    }

    if (params.title) updatedRule.title = params.title
    if (params.folderUid) updatedRule.folderUID = params.folderUid
    if (params.ruleGroup) updatedRule.ruleGroup = params.ruleGroup
    if (params.condition) updatedRule.condition = params.condition
    if (params.forDuration) updatedRule.for = params.forDuration
    if (params.noDataState) updatedRule.noDataState = params.noDataState
    if (params.execErrState) updatedRule.execErrState = params.execErrState
    if (params.isPaused !== undefined) updatedRule.isPaused = params.isPaused
    if (params.keepFiringFor) updatedRule.keep_firing_for = params.keepFiringFor
    if (params.missingSeriesEvalsToResolve !== undefined) {
      updatedRule.missingSeriesEvalsToResolve = params.missingSeriesEvalsToResolve
    }

    if (params.notificationSettings) {
      try {
        updatedRule.notification_settings = JSON.parse(params.notificationSettings)
      } catch {
        return NextResponse.json({
          success: false,
          output: {},
          error: 'Invalid JSON for notificationSettings parameter',
        })
      }
    }

    if (params.record) {
      try {
        updatedRule.record = JSON.parse(params.record)
      } catch {
        return NextResponse.json({
          success: false,
          output: {},
          error: 'Invalid JSON for record parameter',
        })
      }
    }

    if (params.data) {
      try {
        updatedRule.data = JSON.parse(params.data)
      } catch {
        return NextResponse.json({
          success: false,
          output: {},
          error: 'Invalid JSON for data parameter',
        })
      }
    }

    if (params.annotations) {
      try {
        updatedRule.annotations = {
          ...(existingRule.annotations || {}),
          ...JSON.parse(params.annotations),
        }
      } catch {
        return NextResponse.json({
          success: false,
          output: {},
          error: 'Invalid JSON for annotations parameter',
        })
      }
    }

    if (params.labels) {
      try {
        updatedRule.labels = {
          ...(existingRule.labels || {}),
          ...JSON.parse(params.labels),
        }
      } catch {
        return NextResponse.json({
          success: false,
          output: {},
          error: 'Invalid JSON for labels parameter',
        })
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      headers['X-Grafana-Org-Id'] = params.organizationId
    }
    if (params.disableProvenance) {
      headers['X-Disable-Provenance'] = 'true'
    }

    const updateUrl = `${baseUrl}/api/v1/provisioning/alert-rules/${params.alertRuleUid.trim()}`
    const urlValidation = await validateUrlWithDNS(updateUrl, 'baseUrl')
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return NextResponse.json({
        success: false,
        output: {},
        error: `Invalid Grafana baseUrl: ${urlValidation.error}`,
      })
    }

    const updateResponse = await secureFetchWithPinnedIP(updateUrl, urlValidation.resolvedIP, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updatedRule),
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      return NextResponse.json({
        success: false,
        output: {},
        error: `Failed to update alert rule: ${errorText}`,
      })
    }

    const data = (await updateResponse.json()) as Record<string, unknown>
    return NextResponse.json({ success: true, output: mapAlertRule(data) })
  } catch (error) {
    logger.error(`[${requestId}] Error updating Grafana alert rule:`, error)
    return NextResponse.json({
      success: false,
      output: {},
      error: getErrorMessage(error),
    })
  }
})
