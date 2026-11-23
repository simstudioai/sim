import { utf8ByteLength } from '@sim/utils/paste'
import { boundAnswerFindings } from '@sim/workflow-code/diagnostics'
import { type BlobEntry, budgetOfPath, WORKSPACE_ANSWER_BOUND } from '@sim/workspace-code'
import { KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { workflowCodec, workflowFolder } from '@sim/workspace-code/kinds/workflow'
import { kindOfPath } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'
import { renderSourceSlotBusy } from '@/lib/workflows/api/source-slots'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import type { WorkspaceSourceDiagnostic } from '@/lib/workspace-source/application/types'
import { WorkspaceSourceBusyError } from '@/lib/workspace-source/lease/store'
import { SourceStagingFullError } from '@/lib/workspace-source/staging/store'
import { v2CaughtOrchestrationError, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

/**
 * Workspace source routes conceal an unreachable workspace as absent. A refused apply answers its
 * status (`400`, `409` stale, `423` locked, `413` over a limit) with `details.diagnostics`,
 * bounded as every answer's are;
 * `details.code` is `SOURCE_STALE` when a resource changed since the directory was read, else
 * `SOURCE_REJECTED`. An apply while another one writes the workspace answers `409` with
 * `details.code` `SOURCE_BUSY`. Staging past the caller's staging caps answers `413` with
 * `details.code` `SOURCE_STAGING_FULL`, apart from a body over the request limit.
 */
export const v2WorkspaceSourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
  render(error) {
    const busy = renderSourceSlotBusy(error)
    if (busy) return busy
    if (error instanceof WorkspaceSourceRejectedError) {
      return v2ErrorForOrchestration(error.code, error.message, {
        code: error.stale ? 'SOURCE_STALE' : 'SOURCE_REJECTED',
        diagnostics: boundAnswerFindings(error.diagnostics, WORKSPACE_ANSWER_BOUND),
      })
    }
    if (error instanceof WorkspaceSourceBusyError) {
      return v2ErrorForOrchestration(error.code, error.message, { code: 'SOURCE_BUSY' })
    }
    if (error instanceof SourceStagingFullError) {
      return v2ErrorForOrchestration(error.code, error.message, { code: 'SOURCE_STAGING_FULL' })
    }
    return v2CaughtOrchestrationError(error)
  },
})

/**
 * `result` as a workspace source route answers it: its findings bounded once, here at the edge
 * (`WORKSPACE_ANSWER_BOUND`), whichever kinds and stages they came from.
 */
export function withBoundWorkspaceFindings<
  R extends { diagnostics: readonly WorkspaceSourceDiagnostic[] },
>(result: R) {
  return { ...result, diagnostics: boundAnswerFindings(result.diagnostics, WORKSPACE_ANSWER_BOUND) }
}

/** Non-workflow text bytes (declarations and table rows) one source-write unit covers. */
const TEXT_BYTES_PER_UNIT = 2_000_000

/** Binary files listed in the manifest one source-write unit covers. */
const BLOBS_PER_UNIT = 5_000

/**
 * The source-write units a workspace apply (or dry run) costs, at least one: one for each
 * workflow folder it sends with its files, which it evaluates as a single-workflow apply (one
 * unit) would (a folder sent as its base alone is never evaluated); one more for each whole
 * {@link TEXT_BYTES_PER_UNIT} of declarations and table rows it sends, which it parses and diffs;
 * and one more for each whole {@link BLOBS_PER_UNIT} binary files it lists, each of which the plan
 * matches against a stored document or file it lists. A typical directory costs what its
 * evaluated workflows do; the blob bytes themselves are charged when staged.
 */
export function workspaceApplyRateCost(
  files: Readonly<Record<string, string>>,
  blobs: readonly BlobEntry[] = []
): number {
  const workflowPaths: string[] = []
  let textBytes = 0
  for (const [path, text] of Object.entries(files)) {
    const kind = kindOfPath(path)
    if (kind === 'workflow') workflowPaths.push(path)
    else if (kind && budgetOfPath(KIND_LAYOUTS[kind], path) !== 'workflow') {
      textBytes += utf8ByteLength(text)
    }
  }
  const { groups } = workflowCodec.group(workflowPaths)
  let evaluated = 0
  for (const [key, paths] of groups) {
    const folder = `${workflowFolder(key)}/`
    if (paths.some((path) => !path.slice(folder.length).startsWith('.sim/'))) evaluated += 1
  }
  const listed = Math.min(blobs.length, WORKSPACE_SOURCE_LIMITS.maxBlobs)
  return Math.max(
    1,
    evaluated + Math.floor(textBytes / TEXT_BYTES_PER_UNIT) + Math.floor(listed / BLOBS_PER_UNIT)
  )
}
