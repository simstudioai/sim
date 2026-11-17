import { utf8Bytes } from '@sim/workflow-code/limits'
import {
  APPLY_ORDER,
  emptyBase,
  resourceAddress,
  type WorkspaceBaseV1,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { sourceContext } from '@/lib/workspace-source/application/context'
import { refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import { kindLimitFinding, overKindLimit } from '@/lib/workspace-source/application/findings'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import { KIND_ADAPTERS } from '@/lib/workspace-source/application/registry'
import type { ReadBlob, WorkspaceSourceDiagnostic } from '@/lib/workspace-source/application/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export interface ReadWorkspaceSourceInput {
  workspaceId: string
  /** The kinds to read; every kind this server supports when omitted. */
  kinds?: WorkspaceKind[]
}

export interface ReadWorkspaceSourceResult {
  workspaceId: string
  /** The kinds read (a kind the caller may not load is left out): the directory manages these. */
  kinds: WorkspaceKind[]
  /** Workspace-relative path → text. */
  files: Record<string, string>
  blobs: ReadBlob[]
  base: WorkspaceBaseV1
  /** Resources left out, with why (too large to read as source, or not readable by the caller). */
  skipped: Array<{ kind: WorkspaceKind; key: string; reason: string }>
  diagnostics: WorkspaceSourceDiagnostic[]
}

/**
 * What one directory may hold across kinds, so anything a get writes applies back: declaration
 * bytes (every kind's text but workflow files) and listed blobs. A resource that would take the
 * directory past either is left out and listed in `skipped`, in apply order, so earlier kinds
 * are kept whole.
 */
function directoryBudget() {
  const { maxDeclarationBytes, maxBlobs } = WORKSPACE_SOURCE_LIMITS
  let declarationBytes = 0
  let blobs = 0
  return {
    spend(kind: WorkspaceKind, read: { text: Record<string, string>; blobs: ReadBlob[] }) {
      const bytes =
        kind === 'workflow'
          ? 0
          : Object.values(read.text).reduce((total, text) => total + utf8Bytes(text), 0)
      if (declarationBytes + bytes > maxDeclarationBytes) {
        return `its declaration would take the directory past the ${maxDeclarationBytes}-byte declaration limit`
      }
      if (blobs + read.blobs.length > maxBlobs) {
        return `its binary files would take the directory past the ${maxBlobs}-file limit`
      }
      declarationBytes += bytes
      blobs += read.blobs.length
      return null
    },
  }
}

/**
 * Reads a workspace as source: for each requested kind, every stored resource printed as the
 * files `sim workspaces source get` writes, plus the base that binds each key to its id. Each
 * resource is read through the use case that owns it. Like a workflow source get, the one write
 * is key allocation for resources that have no key yet. A kind the caller may not read is reported
 * and skipped; a workflow too large to read as source is listed in `skipped`.
 */
export const readWorkspaceSource = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.read,
  resolveContext: ({ input }: { input: ReadWorkspaceSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ReadWorkspaceSourceResult> {
    await requireWorkflowCodeEnabled()
    const ctx = sourceContext(principal, context)
    const requested = new Set(input.kinds ?? APPLY_ORDER)
    const kinds = APPLY_ORDER.filter((kind) => requested.has(kind))
    const result: ReadWorkspaceSourceResult = {
      workspaceId: context.workspaceId,
      kinds,
      files: {},
      blobs: [],
      base: emptyBase(context.workspaceId),
      skipped: [],
      diagnostics: [],
    }
    const budget = directoryBudget()
    /** Kinds left out: the caller may not load them, or the workspace holds too many. */
    const unread = new Set<WorkspaceKind>()
    for (const kind of kinds) {
      const adapter = KIND_ADAPTERS[kind]
      let stored: Awaited<ReturnType<typeof adapter.load>>
      try {
        stored = await adapter.load(ctx, { allocate: true })
      } catch (error) {
        result.diagnostics.push(refusalDiagnostic(error, { kind }))
        unread.add(kind)
        continue
      }
      if (overKindLimit(stored)) {
        result.diagnostics.push(kindLimitFinding(kind))
        unread.add(kind)
        continue
      }
      for (const [key, resource] of stored.bound) {
        try {
          const read = await adapter.read(resource, ctx)
          const over = budget.spend(kind, read)
          if (over) {
            result.skipped.push({ kind, key, reason: over })
            continue
          }
          Object.assign(result.files, read.text)
          result.blobs.push(...read.blobs)
          result.base.resources[resourceAddress(kind, key)] = read.base
          result.diagnostics.push(...(read.diagnostics ?? []))
        } catch (error) {
          const finding = refusalDiagnostic(error, { kind, key })
          result.skipped.push({ kind, key, reason: finding.message })
        }
      }
    }
    result.kinds = kinds.filter((kind) => !unread.has(kind))
    return result
  },
})
