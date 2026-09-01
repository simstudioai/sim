import { isValidUuid } from '@sim/utils/id'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
} from '@/lib/logs/execution/functional-outputs'
import { logProjectionSubjectUserId } from '@/lib/logs/log-projection'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  describeWorkflowRunFiles,
  getWorkflowRunFiles,
  type WorkflowRunFileDescriptor,
} from '@/lib/workflows/executor/execution-run-files'
import { getProjectedWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

/**
 * Selectors this resource can never answer, so the caller hears about them.
 *
 * This resource reads a recorded run and deliberately never loads the
 * workflow's blocks, so it matches block *ids* only. A selector headed by
 * something that is not a block id — a block name, the shape the streaming
 * execute request accepts — has nothing to resolve against and used to come
 * back as an empty `blockOutputs` with a `200`, which reads exactly like "that
 * block produced nothing".
 *
 * A head that *is* a well-formed id but produced no output stays a legitimate
 * empty answer: the block may simply not have run on this path. That is also
 * why a run carrying no output projection at all — queued, resuming, or asked
 * about without `includeOutput` — is judged on the selector's shape alone
 * rather than waved through: a block *name* has nothing to resolve against on
 * such a run either, and letting it pass restores exactly the silent empty
 * answer this check exists to remove.
 */
function unresolvableSelectors(
  selectedOutputs: readonly string[],
  blockOutputs: Record<string, unknown> | null | undefined
): string[] {
  return selectedOutputs.filter(
    (selector) =>
      !(blockOutputs && Object.hasOwn(blockOutputs, selector)) &&
      !isValidUuid(selector.split('.')[0])
  )
}

export interface ReadWorkflowRunInput {
  workflowId: string
  runId: string
  includeOutput: boolean
  selectedOutputs: string[]
  includeFileBase64?: boolean
  base64MaxBytes?: number
}

export const readWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readRun,
  resolveContext: ({ input }: { input: ReadWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
    }),
  async execute({ principal, context, input }) {
    try {
      /**
       * The projection subject, not an attribution: a workspace API key
       * authorizes as the workspace and represents no user, so it resolves to
       * `undefined` and reads the run whole. Substituting the key's creator would
       * apply a bystander's group to every caller of a shared credential.
       */
      const projected = await getProjectedWorkflowExecutionStatus({
        workflowId: context.workflowId,
        executionId: context.runId,
        includeOutput: input.includeOutput,
        selectedOutputs: input.selectedOutputs,
        workspaceId: context.workspaceId,
        workspaceOrganizationId: context.workspaceOrganizationId,
        viewerUserId: logProjectionSubjectUserId(principal),
      })
      if (!projected) throw new OrchestrationError('not_found', 'Run not found')
      const { status, projection } = projected

      /**
       * A run whose `blockOutputs` the viewer's group withholds joins the same
       * set as a queued or `includeOutput: false` run: the selector is judged on
       * its shape alone. A block *name* still hears that this resource matches
       * ids, and a well-formed id still gets the legitimate empty answer.
       */
      const unresolvable = unresolvableSelectors(input.selectedOutputs, status.blockOutputs)
      if (unresolvable.length > 0) {
        throw new OrchestrationError(
          'validation',
          `selectedOutputs did not resolve to any block on this run: ${unresolvable.join(', ')}. This resource matches block ids only — pass "blockId" or "blockId.path", not a block name.`
        )
      }

      /**
       * File descriptors follow `output`'s gating: they describe the run's
       * output, so a caller that did not ask for output gets `null` rather than
       * a list it did not request. Derived from the run's own recording, which
       * is also where the download endpoint re-derives each storage key.
       *
       * They follow the viewer's projection for the same reason. A run's output
       * files *are* its execution data — the descriptors name them, and
       * `includeFileBase64` hands back their bytes — so a group that withholds
       * `finalOutput` and `blockOutputs` under `logs.trace_spans` and then let
       * the file list through would return the withheld output one field over.
       * The list is `null`, exactly as for a caller that asked for no output,
       * and the read is skipped rather than performed and discarded.
       *
       * This re-reads the run rather than reusing what the status read already
       * loaded, and must: the status read materializes execution data *for
       * display*, a projection that strips `key` and `context` — exactly the
       * fields a file descriptor needs — and it also answers from the job queue
       * for runs that have no log row yet.
       *
       * permission-group-enforced: logs.trace_spans
       */
      let files: WorkflowRunFileDescriptor[] | null = null
      if (input.includeOutput && !projection.hideTraceSpans) {
        const runFiles = await getWorkflowRunFiles({
          workflowId: context.workflowId,
          runId: context.runId,
        })
        files = runFiles
          ? await describeWorkflowRunFiles(runFiles.filesById, {
              workflowId: context.workflowId,
              runId: context.runId,
              includeBase64: input.includeFileBase64 === true,
              base64MaxBytes: input.base64MaxBytes,
            })
          : []
      }

      return { ...status, files }
    } catch (error) {
      if (error instanceof FunctionalOutputsUnavailableError) {
        throw new OrchestrationError('conflict', FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE)
      }
      throw error
    }
  },
})
