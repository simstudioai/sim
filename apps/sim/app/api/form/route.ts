import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { form } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createFormContract } from '@/lib/api/contracts/forms'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isDev } from '@/lib/core/config/feature-flags'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performFullDeploy } from '@/lib/workflows/orchestration'
import {
  checkWorkflowAccessForFormCreation,
  DEFAULT_FORM_CUSTOMIZATIONS,
} from '@/app/api/form/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormAPI')
export const maxDuration = 120

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function cleanupFormAfterDeployFailure(formId: string) {
  try {
    await db.delete(form).where(eq(form.id, formId))
  } catch (cleanupError) {
    logger.error('Failed to clean up form after deploy failure:', cleanupError)
  }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const deployments = await db
      .select()
      .from(form)
      .where(and(eq(form.userId, session.user.id), isNull(form.archivedAt)))

    return createSuccessResponse({ deployments })
  } catch (error) {
    logger.error('Error fetching form deployments:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to fetch form deployments'), 500)
  }
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()

    if (!session) {
      return createErrorResponse('Unauthorized', 401)
    }

    const parsed = await parseRequest(
      createFormContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          createErrorResponse(getValidationErrorMessage(error), 400, 'VALIDATION_ERROR'),
      }
    )
    if (!parsed.success) return parsed.response

    const {
      workflowId,
      identifier,
      title,
      description = '',
      customizations,
      authType = 'public',
      password,
      allowedEmails = [],
      showBranding = true,
    } = parsed.data.body

    if (authType === 'password' && !password) {
      return createErrorResponse('Password is required when using password protection', 400)
    }

    if (authType === 'email' && (!Array.isArray(allowedEmails) || allowedEmails.length === 0)) {
      return createErrorResponse(
        'At least one email or domain is required when using email access control',
        400
      )
    }

    // Check identifier availability and workflow access in parallel
    const [existingIdentifier, { hasAccess, workflow: workflowRecord }] = await Promise.all([
      db
        .select()
        .from(form)
        .where(and(eq(form.identifier, identifier), isNull(form.archivedAt)))
        .limit(1),
      checkWorkflowAccessForFormCreation(workflowId, session.user.id),
    ])

    if (existingIdentifier.length > 0) {
      return createErrorResponse('Identifier already in use', 400)
    }

    if (!hasAccess || !workflowRecord) {
      return createErrorResponse('Workflow not found or access denied', 404)
    }

    let encryptedPassword = null
    if (authType === 'password' && password) {
      const { encrypted } = await encryptSecret(password)
      encryptedPassword = encrypted
    }

    const id = generateId()

    logger.info('Creating form deployment with values:', {
      workflowId,
      identifier,
      title,
      authType,
      hasPassword: !!encryptedPassword,
      emailCount: allowedEmails?.length || 0,
      showBranding,
    })

    const mergedCustomizations = {
      ...DEFAULT_FORM_CUSTOMIZATIONS,
      ...(customizations || {}),
    }

    await db.insert(form).values({
      id,
      workflowId,
      userId: session.user.id,
      identifier,
      title,
      description: description || null,
      customizations: mergedCustomizations,
      isActive: true,
      authType,
      password: encryptedPassword,
      allowedEmails: authType === 'email' ? allowedEmails : [],
      showBranding,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    let result: Awaited<ReturnType<typeof performFullDeploy>>
    try {
      result = await performFullDeploy({
        workflowId,
        userId: session.user.id,
        request,
      })
    } catch (error) {
      await cleanupFormAfterDeployFailure(id)
      throw error
    }

    if (!result.success) {
      await cleanupFormAfterDeployFailure(id)
      const status =
        result.errorCode === 'validation' ? 400 : result.errorCode === 'not_found' ? 404 : 500
      return createErrorResponse(result.error || 'Failed to deploy workflow', status)
    }

    logger.info(
      `${workflowRecord.isDeployed ? 'Redeployed' : 'Auto-deployed'} workflow ${workflowId} for form (v${result.version})`
    )

    const baseDomain = getEmailDomain()
    const protocol = isDev ? 'http' : 'https'
    const formUrl = `${protocol}://${baseDomain}/form/${identifier}`

    logger.info(`Form "${title}" deployed successfully at ${formUrl}`)

    recordAudit({
      workspaceId: workflowRecord.workspaceId ?? null,
      actorId: session.user.id,
      action: AuditAction.FORM_CREATED,
      resourceType: AuditResourceType.FORM,
      resourceId: id,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: title,
      description: `Created form "${title}" for workflow ${workflowId}`,
      metadata: { identifier, workflowId, authType, formUrl, showBranding },
      request,
    })

    return createSuccessResponse({
      id,
      formUrl,
      message: 'Form deployment created successfully',
    })
  } catch (error) {
    logger.error('Error creating form deployment:', error)
    return createErrorResponse(getErrorMessage(error, 'Failed to create form deployment'), 500)
  }
})
