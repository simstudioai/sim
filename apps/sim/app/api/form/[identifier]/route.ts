import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { form, workflow, workflowBlocks } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addCorsHeaders, validateAuthToken } from '@/lib/core/security/deployment'
import { generateRequestId } from '@/lib/core/utils/request'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { setFormAuthCookie, validateFormAuth } from '@/app/api/form/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('FormIdentifierAPI')

const formPostBodySchema = z.object({
  formData: z.record(z.unknown()).optional(),
  password: z.string().optional(),
  email: z.string().email('Invalid email format').optional().or(z.literal('')),
})

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Get the input format schema from the workflow's start block
 */
async function getWorkflowInputSchema(workflowId: string): Promise<any[]> {
  try {
    const blocks = await db
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))

    const startBlock = blocks.find((block) => isInputDefinitionTrigger(block.type))

    if (!startBlock) {
      return []
    }

    const subBlocks = startBlock.subBlocks as Record<string, any> | null
    return normalizeInputFormatValue(subBlocks?.inputFormat?.value)
  } catch (error) {
    logger.error('Error fetching workflow input schema:', error)
    return []
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing form submission for identifier: ${identifier}`)

    let parsedBody
    try {
      const rawBody = await request.json()
      const validation = formPostBodySchema.safeParse(rawBody)

      if (!validation.success) {
        const errorMessage = validation.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ')
        logger.warn(`[${requestId}] Validation error: ${errorMessage}`)
        return addCorsHeaders(
          createErrorResponse(`Invalid request body: ${errorMessage}`, 400),
          request
        )
      }

      parsedBody = validation.data
    } catch (_error) {
      return addCorsHeaders(createErrorResponse('Invalid request body', 400), request)
    }

    const deploymentResult = await db
      .select({
        id: form.id,
        workflowId: form.workflowId,
        userId: form.userId,
        isActive: form.isActive,
        authType: form.authType,
        password: form.password,
        allowedEmails: form.allowedEmails,
        customizations: form.customizations,
      })
      .from(form)
      .where(eq(form.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Form not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Form not found', 404), request)
    }

    const deployment = deploymentResult[0]

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Form is not active: ${identifier}`)

      const [workflowRecord] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, deployment.workflowId))
        .limit(1)

      const workspaceId = workflowRecord?.workspaceId
      if (!workspaceId) {
        logger.warn(`[${requestId}] Cannot log: workflow ${deployment.workflowId} has no workspace`)
        return addCorsHeaders(
          createErrorResponse('This form is currently unavailable', 403),
          request
        )
      }

      const executionId = randomUUID()
      const loggingSession = new LoggingSession(
        deployment.workflowId,
        executionId,
        'form',
        requestId
      )

      await loggingSession.safeStart({
        userId: deployment.userId,
        workspaceId,
        variables: {},
      })

      await loggingSession.safeCompleteWithError({
        error: {
          message: 'This form is currently unavailable. The form has been disabled.',
          stackTrace: undefined,
        },
        traceSpans: [],
      })

      return addCorsHeaders(createErrorResponse('This form is currently unavailable', 403), request)
    }

    const authResult = await validateFormAuth(requestId, deployment, request, parsedBody)
    if (!authResult.authorized) {
      return addCorsHeaders(
        createErrorResponse(authResult.error || 'Authentication required', 401),
        request
      )
    }

    const { formData, password, email } = parsedBody

    // If only authentication credentials provided (no form data), just return authenticated
    if ((password || email) && !formData) {
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)
      setFormAuthCookie(response, deployment.id, deployment.authType, deployment.password)
      return response
    }

    if (!formData || Object.keys(formData).length === 0) {
      return addCorsHeaders(createErrorResponse('No form data provided', 400), request)
    }

    const executionId = randomUUID()
    const loggingSession = new LoggingSession(deployment.workflowId, executionId, 'form', requestId)

    const preprocessResult = await preprocessExecution({
      workflowId: deployment.workflowId,
      userId: deployment.userId,
      triggerType: 'form',
      executionId,
      requestId,
      checkRateLimit: true,
      checkDeployment: true,
      loggingSession,
    })

    if (!preprocessResult.success) {
      logger.warn(`[${requestId}] Preprocessing failed: ${preprocessResult.error?.message}`)
      return addCorsHeaders(
        createErrorResponse(
          preprocessResult.error?.message || 'Failed to process request',
          preprocessResult.error?.statusCode || 500
        ),
        request
      )
    }

    const { actorUserId, workflowRecord } = preprocessResult
    const workspaceOwnerId = actorUserId!
    const workspaceId = workflowRecord?.workspaceId
    if (!workspaceId) {
      logger.error(`[${requestId}] Workflow ${deployment.workflowId} has no workspaceId`)
      return addCorsHeaders(
        createErrorResponse('Workflow has no associated workspace', 500),
        request
      )
    }

    try {
      const workflowForExecution = {
        id: deployment.workflowId,
        userId: deployment.userId,
        workspaceId,
        isDeployed: workflowRecord?.isDeployed ?? false,
        variables: (workflowRecord?.variables ?? {}) as Record<string, unknown>,
      }

      // Pass form data as the workflow input
      const workflowInput = {
        input: formData,
        ...formData, // Spread form fields at top level for convenience
      }

      // Execute workflow using streaming (for consistency with chat)
      const stream = await createStreamingResponse({
        requestId,
        workflow: workflowForExecution,
        input: workflowInput,
        executingUserId: workspaceOwnerId,
        streamConfig: {
          selectedOutputs: [],
          isSecureMode: true,
          workflowTriggerType: 'api', // Use 'api' type since form is similar
        },
        executionId,
      })

      // For forms, we don't stream back - we wait for completion and return success
      // Consume the stream to wait for completion
      const reader = stream.getReader()
      let lastOutput: any = null

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Parse SSE data if present
          const text = new TextDecoder().decode(value)
          const lines = text.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'complete' || data.output) {
                  lastOutput = data.output || data
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      logger.info(`[${requestId}] Form submission successful for ${identifier}`)

      // Return success with customizations for thank you screen
      const customizations = deployment.customizations as Record<string, any> | null
      return addCorsHeaders(
        createSuccessResponse({
          success: true,
          executionId,
          thankYouTitle: customizations?.thankYouTitle || 'Thank you!',
          thankYouMessage:
            customizations?.thankYouMessage || 'Your response has been submitted successfully.',
        }),
        request
      )
    } catch (error: any) {
      logger.error(`[${requestId}] Error processing form submission:`, error)
      return addCorsHeaders(
        createErrorResponse(error.message || 'Failed to process form submission', 500),
        request
      )
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing form submission:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to process form submission', 500),
      request
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Fetching form info for identifier: ${identifier}`)

    const deploymentResult = await db
      .select({
        id: form.id,
        title: form.title,
        description: form.description,
        customizations: form.customizations,
        isActive: form.isActive,
        workflowId: form.workflowId,
        authType: form.authType,
        password: form.password,
        allowedEmails: form.allowedEmails,
        showBranding: form.showBranding,
      })
      .from(form)
      .where(eq(form.identifier, identifier))
      .limit(1)

    if (deploymentResult.length === 0) {
      logger.warn(`[${requestId}] Form not found for identifier: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Form not found', 404), request)
    }

    const deployment = deploymentResult[0]

    if (!deployment.isActive) {
      logger.warn(`[${requestId}] Form is not active: ${identifier}`)
      return addCorsHeaders(createErrorResponse('This form is currently unavailable', 403), request)
    }

    // Get the workflow's input schema
    const inputSchema = await getWorkflowInputSchema(deployment.workflowId)

    const cookieName = `form_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)

    // If authenticated (via cookie), return full form config
    if (
      deployment.authType !== 'public' &&
      authCookie &&
      validateAuthToken(authCookie.value, deployment.id, deployment.password)
    ) {
      return addCorsHeaders(
        createSuccessResponse({
          id: deployment.id,
          title: deployment.title,
          description: deployment.description,
          customizations: deployment.customizations,
          authType: deployment.authType,
          showBranding: deployment.showBranding,
          inputSchema,
        }),
        request
      )
    }

    // Check authentication requirement
    const authResult = await validateFormAuth(requestId, deployment, request)
    if (!authResult.authorized) {
      // Return limited info for auth required forms
      logger.info(
        `[${requestId}] Authentication required for form: ${identifier}, type: ${deployment.authType}`
      )
      return addCorsHeaders(
        NextResponse.json(
          {
            success: false,
            error: authResult.error || 'Authentication required',
            authType: deployment.authType,
            title: deployment.title,
            customizations: {
              primaryColor: (deployment.customizations as any)?.primaryColor,
              logoUrl: (deployment.customizations as any)?.logoUrl,
            },
          },
          { status: 401 }
        ),
        request
      )
    }

    return addCorsHeaders(
      createSuccessResponse({
        id: deployment.id,
        title: deployment.title,
        description: deployment.description,
        customizations: deployment.customizations,
        authType: deployment.authType,
        showBranding: deployment.showBranding,
        inputSchema,
      }),
      request
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching form info:`, error)
    return addCorsHeaders(
      createErrorResponse(error.message || 'Failed to fetch form information', 500),
      request
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return addCorsHeaders(new NextResponse(null, { status: 204 }), request)
}
