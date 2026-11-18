import { utf8Bytes } from '@sim/workflow-code/limits'
import type { BlobEntry } from '@sim/workspace-code'
import { budgetOfPath } from '@sim/workspace-code'
import { KIND_LAYOUTS } from '@sim/workspace-code/kinds/registry'
import { workflowCodec, workflowFolder } from '@sim/workspace-code/kinds/workflow'
import { kindOfPath } from '@sim/workspace-code/layout'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'
import type { ApplicationOperation, AuthorizingUseCase } from '@/lib/core/application'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { WorkspaceSourceBusyError } from '@/lib/workspace-source/lease/store'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2ErrorForOrchestration,
} from '@/app/api/v2/lib/response'

/** Workspace source requests of one lane this server process runs at once. */
const MAX_CONCURRENT_SOURCE_REQUESTS = { read: 4, apply: 4 } as const

type SourceLane = keyof typeof MAX_CONCURRENT_SOURCE_REQUESTS

const runningSourceRequests: Record<SourceLane, number> = { read: 0, apply: 0 }

/** Seconds a request refused for want of a slot is told to wait. */
const SOURCE_BUSY_RETRY_AFTER_SECONDS = 5

/** A workspace source request refused because this process already runs as many as it may. */
class SourceSlotBusyError extends Error {
  constructor(readonly lane: SourceLane) {
    super(
      `This server is already running ${MAX_CONCURRENT_SOURCE_REQUESTS[lane]} workspace source ${lane === 'read' ? 'gets' : 'applies'}; retry shortly.`
    )
    this.name = 'SourceSlotBusyError'
  }
}

/**
 * `useCase`, run in one of its lane's slots: a get or an apply (each holds a directory's worth of
 * text, stored state and canonical forms in memory) waits for nothing, and is refused with
 * {@link SourceSlotBusyError} (`429` with `Retry-After`) when the process already runs
 * {@link MAX_CONCURRENT_SOURCE_REQUESTS} of them, so a burst cannot run the process out of memory.
 */
export function withSourceSlot<O extends ApplicationOperation, I, R>(
  useCase: AuthorizingUseCase<O, I, R>,
  lane: SourceLane
): AuthorizingUseCase<O, I, R> {
  return {
    ...useCase,
    async execute(args) {
      if (runningSourceRequests[lane] >= MAX_CONCURRENT_SOURCE_REQUESTS[lane]) {
        throw new SourceSlotBusyError(lane)
      }
      runningSourceRequests[lane] += 1
      try {
        return await useCase.execute(args)
      } finally {
        runningSourceRequests[lane] -= 1
      }
    },
  }
}

/**
 * Workspace source routes conceal an unreachable workspace as absent. A refused apply answers its
 * status (`400`, `409` stale, `423` locked, `413` over a limit) with `details.diagnostics`;
 * `details.code` is `SOURCE_STALE` when a resource changed since the directory was read, else
 * `SOURCE_REJECTED`. An apply while another one writes the workspace answers `409` with
 * `details.code` `SOURCE_BUSY`.
 */
export const v2WorkspaceSourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
  render(error) {
    if (error instanceof SourceSlotBusyError) {
      return v2Error('RATE_LIMITED', error.message, {
        headers: { 'Retry-After': String(SOURCE_BUSY_RETRY_AFTER_SECONDS) },
      })
    }
    if (error instanceof WorkspaceSourceRejectedError) {
      return v2ErrorForOrchestration(error.code, error.message, {
        code: error.stale ? 'SOURCE_STALE' : 'SOURCE_REJECTED',
        diagnostics: error.diagnostics,
      })
    }
    if (error instanceof WorkspaceSourceBusyError) {
      return v2ErrorForOrchestration(error.code, error.message, { code: 'SOURCE_BUSY' })
    }
    return v2CaughtOrchestrationError(error)
  },
})

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
      textBytes += utf8Bytes(text)
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
