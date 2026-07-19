import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { submitInterfaceFormContract } from '@/lib/api/contracts/interfaces'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { type FormSubmissionFieldError, validateFormSubmission } from '@/lib/interfaces'
import { captureServerEvent } from '@/lib/posthog/server'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { resolveInterfaceAccess } from '@/app/api/interfaces/utils'

const logger = createLogger('InterfaceFormSubmitAPI')

/**
 * Shapes per-field submission errors as validation issues.
 *
 * The client's shared `extractValidationIssues` helper only recognises a 400 as
 * a validation failure when each `details` entry carries an array `path`. Adding
 * it lets `useSubmitInterfaceForm` suppress its generic toast so the form module
 * renders the messages inline, while `fieldId` stays the key callers map on.
 */
function toFieldErrorDetails(errors: FormSubmissionFieldError[]) {
  return errors.map((error) => ({ ...error, path: ['values', error.fieldId] }))
}

/**
 * POST /api/interfaces/[interfaceId]/modules/[moduleId]/submit - Validates a
 * form module's submitted values and runs its connected workflow.
 *
 * Values arrive keyed by field id and are rebuilt into a flat start-block input
 * keyed by field name. Runs enter at the Start block like `api`/`chat`, so no
 * `triggerBlockId` is passed; deployment and rate-limit checks come from
 * `preprocessExecution`'s defaults for the `'form'` trigger type.
 *
 * Write permission is required: a submit executes a workflow and bills the
 * workspace, so a read-only member must not be able to trigger runs.
 */
export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ interfaceId: string; moduleId: string }> }
  ) => {
    const requestId = generateRequestId()

    try {
      const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!authResult.success || !authResult.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = await parseRequest(submitInterfaceFormContract, request, context)
      if (!parsed.success) return parsed.response

      const { interfaceId, moduleId } = parsed.data.params
      const { body } = parsed.data

      const access = await resolveInterfaceAccess({
        interfaceId,
        workspaceId: body.workspaceId,
        userId: authResult.userId,
        level: 'write',
        requestId,
      })
      if (!access.ok) return access.response

      const targetModule = access.definition.layout.modules.find((entry) => entry.id === moduleId)
      if (!targetModule) {
        return NextResponse.json({ error: 'Module not found' }, { status: 404 })
      }
      if (targetModule.type !== 'form') {
        return NextResponse.json({ error: 'Module is not a form' }, { status: 400 })
      }
      if (!targetModule.config.workflowId) {
        return NextResponse.json(
          { error: 'This form is not connected to a workflow' },
          { status: 400 }
        )
      }

      const submission = validateFormSubmission(targetModule.config.fields, body.values)
      if (!submission.valid) {
        return NextResponse.json(
          { error: 'Invalid form submission', details: toFieldErrorDetails(submission.errors) },
          { status: 400 }
        )
      }

      const workflowId = targetModule.config.workflowId
      const executionId = generateId()

      const preprocess = await preprocessExecution({
        workflowId,
        userId: authResult.userId,
        useAuthenticatedUserAsActor: true,
        triggerType: 'form',
        executionId,
        requestId,
      })
      if (!preprocess.success) {
        logger.warn(`[${requestId}] Form submit preprocessing failed: ${preprocess.error.message}`)
        return NextResponse.json(
          { error: preprocess.error.message },
          { status: preprocess.error.statusCode }
        )
      }

      const { actorUserId, workflowRecord, billingAttribution } = preprocess
      if (!workflowRecord.workspaceId) {
        logger.error(`[${requestId}] Workflow ${workflowId} has no workspaceId`)
        /**
         * `preprocessExecution` reserved a billing concurrency slot; release it
         * on this early exit since no LoggingSession will finalize to free it.
         * When `executeWorkflow` throws, its LoggingSession releases the slot —
         * releasing again there would double-free.
         */
        await releaseExecutionSlot(executionId)
        return NextResponse.json({ error: 'Workflow has no associated workspace' }, { status: 500 })
      }

      const result = await executeWorkflow(
        {
          id: workflowRecord.id,
          userId: workflowRecord.userId,
          workspaceId: workflowRecord.workspaceId,
          isDeployed: workflowRecord.isDeployed,
          variables: (workflowRecord.variables as Record<string, unknown>) ?? {},
        },
        requestId,
        submission.input,
        actorUserId,
        {
          enabled: true,
          executionMode: 'sync',
          workflowTriggerType: 'form',
          billingAttribution,
        },
        executionId
      )

      /**
       * `executeWorkflow` resolves normally when a block fails — the failure is
       * carried on `result.success`, not thrown. Returning 200 regardless would
       * render a "Submitted" confirmation and clear the visitor's input for a
       * run that produced nothing, so an unsuccessful run is surfaced as a 502:
       * the request itself was well-formed, the upstream workflow is what
       * failed.
       *
       * A paused run carries `success: true` with `status: 'paused'` and counts
       * as accepted — the submission reached the workflow and is awaiting a
       * resume, exactly as the workflow execute route treats it.
       */
      if (!result.success) {
        logger.warn(
          `[${requestId}] Form module ${moduleId} on interface ${interfaceId} ran workflow ${workflowId} unsuccessfully`,
          { error: result.error }
        )
        return NextResponse.json(
          { error: result.error ?? 'The connected workflow failed to run' },
          { status: 502 }
        )
      }

      logger.info(
        `[${requestId}] Submitted form module ${moduleId} on interface ${interfaceId} (workflow ${workflowId})`
      )

      captureServerEvent(
        authResult.userId,
        'interface_form_submitted',
        {
          interface_id: interfaceId,
          module_id: moduleId,
          workspace_id: access.definition.workspaceId,
          workflow_id: workflowId,
        },
        { groups: { workspace: access.definition.workspaceId } }
      )

      return NextResponse.json({
        success: true,
        data: {
          executionId: result.metadata?.executionId ?? executionId,
          output: result.output,
        },
      })
    } catch (error) {
      logger.error(`[${requestId}] Failed to submit interface form`, error)
      return NextResponse.json({ error: 'Failed to submit interface form' }, { status: 500 })
    }
  }
)
