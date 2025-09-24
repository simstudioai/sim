import { db } from '@sim/db'
import { workflow, workflowForm } from '@sim/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { quickValidateEmail } from '@/lib/email/validation'
import { env, isTruthy } from '@/lib/env'
import { IdempotencyService, webhookIdempotency } from '@/lib/idempotency/service'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { executeFormSubmissionJob } from '@/background/form-execution'
import { RateLimiter } from '@/services/queue'

const logger = createLogger('FormSubmissionAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const requestId = generateRequestId()
  let foundWorkflow: any = null
  let foundForm: any = null

  let body: any
  try {
    body = await request.json()

    if (!body || Object.keys(body).length === 0) {
      logger.warn(`[${requestId}] Rejecting empty form submission`)
      return new NextResponse('Empty form submission', { status: 400 })
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse form submission`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
    })
    return new NextResponse('Invalid form data', { status: 400 })
  }

  const formId = (await params).formId
  logger.info(`[${requestId}] Processing form submission for form: ${formId}`)

  const forms = await db
    .select({
      form: workflowForm,
      workflow: workflow,
    })
    .from(workflowForm)
    .innerJoin(workflow, eq(workflowForm.workflowId, workflow.id))
    .where(and(eq(workflowForm.path, formId), eq(workflowForm.isActive, true)))
    .limit(1)

  if (forms.length === 0) {
    logger.warn(`[${requestId}] No active form found for path: ${formId}`)
    return new NextResponse('Form not found', { status: 404 })
  }

  foundForm = forms[0].form
  foundWorkflow = forms[0].workflow

  try {
    const formConfig = foundForm.formConfig as any
    const fields = formConfig.fields || []

    for (const field of fields) {
      if (field.required && (!body[field.name] || body[field.name] === '')) {
        logger.warn(`[${requestId}] Missing required field: ${field.name}`)
        return NextResponse.json({ error: `Field '${field.label}' is required` }, { status: 400 })
      }

      if (body[field.name] && field.type === 'email') {
        const validation = quickValidateEmail(body[field.name])
        if (!validation.isValid) {
          return NextResponse.json(
            { error: `Field '${field.label}' must be a valid email: ${validation.reason}` },
            { status: 400 }
          )
        }
      }
    }

    logger.debug(`[${requestId}] Form validation passed`)
  } catch (validationError) {
    logger.error(`[${requestId}] Form validation error:`, validationError)
    return new NextResponse('Form validation failed', { status: 400 })
  }

  try {
    const userSubscription = await getHighestPrioritySubscription(foundWorkflow.userId)

    logger.info(`[${requestId}] Rate limiting check for user ${foundWorkflow.userId}`, {
      userId: foundWorkflow.userId,
      subscription: userSubscription,
      plan: userSubscription?.plan || 'free',
    })

    const rateLimiter = new RateLimiter()
    const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
      foundWorkflow.userId,
      userSubscription,
      'form',
      true
    )

    logger.info(`[${requestId}] Rate limit check result`, {
      allowed: rateLimitCheck.allowed,
      remaining: rateLimitCheck.remaining,
      resetAt: rateLimitCheck.resetAt,
    })

    if (!rateLimitCheck.allowed) {
      logger.warn(`[${requestId}] Rate limit exceeded for form user ${foundWorkflow.userId}`, {
        remaining: rateLimitCheck.remaining,
        resetAt: rateLimitCheck.resetAt,
      })

      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    logger.debug(`[${requestId}] Rate limit check passed for form`, {
      remaining: rateLimitCheck.remaining,
      resetAt: rateLimitCheck.resetAt,
    })
  } catch (rateLimitError) {
    logger.error(`[${requestId}] Error checking form rate limits:`, rateLimitError)
  }

  try {
    const usageCheck = await checkServerSideUsageLimits(foundWorkflow.userId)
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] User ${foundWorkflow.userId} has exceeded usage limits. Skipping form execution.`,
        {
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: foundWorkflow.id,
        }
      )

      return NextResponse.json(
        { error: 'Usage limit exceeded. Please upgrade your plan to continue.' },
        { status: 429 }
      )
    }

    logger.debug(`[${requestId}] Usage limit check passed for form`, {
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
  } catch (usageError) {
    logger.error(`[${requestId}] Error checking form usage limits:`, usageError)
  }

  try {
    const payload = {
      formId: foundForm.id,
      workflowId: foundWorkflow.id,
      userId: foundWorkflow.userId,
      formData: body,
      headers: Object.fromEntries(request.headers.entries()),
      path: formId,
      blockId: foundForm.blockId,
    }

    const idempotencyKey = IdempotencyService.createWebhookIdempotencyKey(
      foundForm.id,
      Object.fromEntries(request.headers.entries())
    )

    const runOperation = async () => {
      const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

      if (useTrigger) {
        const handle = await tasks.trigger('form-submission', payload)
        logger.info(`[${requestId}] Queued form submission task ${handle.id}`)
        return {
          method: 'trigger.dev',
          taskId: handle.id,
          status: 'queued',
        }
      }

      void executeFormSubmissionJob(payload).catch((error) => {
        logger.error(`[${requestId}] Direct form execution failed`, error)
      })

      logger.info(`[${requestId}] Queued direct form execution (Trigger.dev disabled)`)
      return {
        method: 'direct',
        status: 'queued',
      }
    }

    const result = await webhookIdempotency.executeWithIdempotency(
      'form',
      idempotencyKey,
      runOperation
    )

    logger.debug(`[${requestId}] Form submission result:`, result)

    const settings = foundForm.settings as any
    const successMessage = settings?.successMessage || 'Thank you for your submission!'
    const redirectUrl = settings?.redirectUrl

    const response: any = {
      success: true,
      message: successMessage,
    }

    if (redirectUrl) {
      response.redirectUrl = redirectUrl
    }

    return NextResponse.json(response)
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to process form submission:`, error)
    return NextResponse.json({ error: 'Failed to process form submission' }, { status: 500 })
  }
}
