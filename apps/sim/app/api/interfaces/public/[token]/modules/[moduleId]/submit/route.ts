import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import {
  PUBLIC_INTERFACE_MAX_BODY_BYTES,
  submitPublicInterfaceFormContract,
} from '@/lib/api/contracts/public-interfaces'
import { parseRequest } from '@/lib/api/server'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { admissionRejectedResponse, tryAdmit } from '@/lib/core/admission/gate'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { type FormSubmissionFieldError, validateFormSubmission } from '@/lib/interfaces'
import { resolvePublicInterfaceModule } from '@/lib/public-shares/interface-access'
import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import {
  publicInterfaceJson,
  publicInterfaceNotFound,
  publicRunFailure,
} from '@/app/api/interfaces/public/[token]/modules/[moduleId]/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('PublicInterfaceFormSubmitAPI')

/**
 * Shapes per-field submission errors as validation issues, byte-identical to the
 * in-app submit route — `FormModule` reads `details[].fieldId` to render errors
 * inline, and the shared client helper only treats a 400 as a validation failure
 * when each entry carries an array `path`.
 */
function toFieldErrorDetails(errors: FormSubmissionFieldError[]) {
  return errors.map((error) => ({ ...error, path: ['values', error.fieldId] }))
}

/**
 * POST /api/interfaces/public/[token]/modules/[moduleId]/submit
 *
 * Validates a public visitor's form submission against the **stored** field
 * definitions and runs the module's connected workflow. The workflow id is
 * derived from the interface's stored layout and re-asserted to live in the
 * interface's own workspace; the route accepts no workflow, workspace, or
 * interface identifier of any kind.
 *
 * Values arrive keyed by field id and are rebuilt into a flat start-block input
 * keyed by field name, so a value for a field the interface does not declare is
 * rejected rather than forwarded into the run. Deployment and the per-actor plan
 * limit are both required — the run spends the workspace's billing account for
 * an anonymous caller — and the actor is the workspace system actor, never the
 * sharer personally.
 */
export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; moduleId: string }> }
  ) => {
    const requestId = generateRequestId()

    const ticket = tryAdmit()
    if (!ticket) return admissionRejectedResponse()

    try {
      const limited = await enforcePerIpRateLimit(request, 'execute')
      if (limited) return limited

      const parsed = await parseRequest(submitPublicInterfaceFormContract, request, context, {
        maxBodyBytes: PUBLIC_INTERFACE_MAX_BODY_BYTES,
      })
      if (!parsed.success) return parsed.response
      const { token, moduleId } = parsed.data.params
      const { values } = parsed.data.body

      const result = await resolvePublicInterfaceModule({
        token,
        moduleId,
        expectedType: 'form',
        request,
        requestId,
      })
      if (!result.ok) return result.response
      const { definition, module, share, workspaceId, resource } = result.access

      /**
       * The share is only known after the token resolves, so the aggregate
       * per-share ceiling is enforced here rather than alongside the per-IP
       * bucket above. Both apply.
       */
      const shareLimited = await enforcePerShareRateLimit('execute', share.id)
      if (shareLimited) return shareLimited

      /** Narrowing formality — `expectedType: 'form'` already 404s any other type. */
      if (module.type !== 'form') return publicInterfaceNotFound()

      const submission = validateFormSubmission(module.config.fields, values)
      if (!submission.valid) {
        return publicInterfaceJson(
          { error: 'Invalid form submission', details: toFieldErrorDetails(submission.errors) },
          400
        )
      }

      const workflowId = resource.id
      const executionId = generateId()

      const preprocess = await preprocessExecution({
        workflowId,
        userId: definition.createdBy,
        triggerType: 'form',
        executionId,
        requestId,
        checkRateLimit: true,
        checkDeployment: true,
      })

      if (!preprocess.success) {
        logger.warn(`[${requestId}] Public interface form preprocessing failed`, {
          moduleId,
          status: preprocess.error.statusCode,
          error: preprocess.error.message,
        })
        return publicRunFailure(preprocess.error.statusCode)
      }

      const { actorUserId, billingAttribution, workflowRecord } = preprocess

      /**
       * Re-assert same-workspace on the resolved workflow. `validateLayout`
       * grandfathers references that were already stored, so a stored reference
       * is only proven in-workspace at the moment it was introduced.
       *
       * `preprocessExecution` reserved a billing concurrency slot; release it on
       * this early exit since no LoggingSession will finalize to free it. When
       * `executeWorkflow` throws, its LoggingSession releases the slot —
       * releasing again there would double-free.
       */
      if (workflowRecord.workspaceId !== workspaceId) {
        logger.warn(`[${requestId}] Public interface form workflow left the workspace`, {
          moduleId,
        })
        await releaseExecutionSlot(executionId)
        return publicInterfaceNotFound()
      }

      const run = await executeWorkflow(
        {
          id: workflowId,
          userId: workflowRecord.userId,
          workspaceId,
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
       * carried on `run.success`, not thrown. Returning 200 regardless would
       * render a "Submitted" confirmation and clear the visitor's input for a run
       * that produced nothing, so an unsuccessful run is a 502: the request was
       * well-formed, the upstream workflow is what failed. A paused run carries
       * `success: true` and counts as accepted.
       *
       * The workflow's own error text stays server-side — it names blocks and
       * upstream services the visitor has no business seeing.
       */
      if (!run.success) {
        logger.warn(`[${requestId}] Public interface form ran its workflow unsuccessfully`, {
          moduleId,
          error: run.error,
        })
        return publicRunFailure(502)
      }

      logger.info(`[${requestId}] Public interface form submitted`, {
        moduleId,
        interfaceId: definition.id,
      })

      return publicInterfaceJson({
        success: true,
        data: {
          executionId: run.metadata?.executionId ?? executionId,
          output: run.output,
        },
      })
    } finally {
      ticket.release()
    }
  }
)
