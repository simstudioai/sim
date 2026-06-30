import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { grafanaUpdateFolderContract } from '@/lib/api/contracts/tools/grafana'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('GrafanaUpdateFolderAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Grafana update folder attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      grafanaUpdateFolderContract,
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      headers['X-Grafana-Org-Id'] = params.organizationId
    }

    const folderUrl = `${baseUrl}/api/folders/${params.folderUid.trim()}`
    const urlValidation = await validateUrlWithDNS(folderUrl, 'baseUrl')
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return NextResponse.json({
        success: false,
        output: {},
        error: `Invalid Grafana baseUrl: ${urlValidation.error}`,
      })
    }

    const getResponse = await secureFetchWithPinnedIP(folderUrl, urlValidation.resolvedIP, {
      method: 'GET',
      headers,
    })

    if (!getResponse.ok) {
      const errorText = await getResponse.text()
      return NextResponse.json({
        success: false,
        output: {},
        error: `Failed to fetch existing folder: ${errorText}`,
      })
    }

    const existingFolder = (await getResponse.json()) as any

    if (!existingFolder || !existingFolder.uid) {
      return NextResponse.json({
        success: false,
        output: {},
        error: 'Failed to fetch existing folder',
      })
    }

    const body: Record<string, unknown> = {
      title: params.title ?? existingFolder.title,
      version: existingFolder.version,
      overwrite: true,
    }

    const updateResponse = await secureFetchWithPinnedIP(folderUrl, urlValidation.resolvedIP, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      return NextResponse.json({
        success: false,
        output: {},
        error: `Failed to update folder: ${errorText}`,
      })
    }

    const data = (await updateResponse.json()) as Record<string, unknown>

    return NextResponse.json({
      success: true,
      output: {
        id: (data.id as number) ?? null,
        uid: (data.uid as string) ?? null,
        title: (data.title as string) ?? null,
        url: (data.url as string) ?? null,
        parentUid: (data.parentUid as string) ?? null,
        parents: (data.parents as { uid: string; title: string; url: string }[]) ?? [],
        hasAcl: (data.hasAcl as boolean) ?? null,
        canSave: (data.canSave as boolean) ?? null,
        canEdit: (data.canEdit as boolean) ?? null,
        canAdmin: (data.canAdmin as boolean) ?? null,
        createdBy: (data.createdBy as string) ?? null,
        created: (data.created as string) ?? null,
        updatedBy: (data.updatedBy as string) ?? null,
        updated: (data.updated as string) ?? null,
        version: (data.version as number) ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating Grafana folder:`, error)
    return NextResponse.json({
      success: false,
      output: {},
      error: getErrorMessage(error),
    })
  }
})
