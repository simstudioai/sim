import { chunkArray } from '@sim/utils/helpers'
import { utf8ByteLength } from '@sim/utils/paste'
import {
  APPLY_ORDER,
  budgetOfPath,
  emptyBase,
  resourceAddress,
  type SourceBudget,
  type WorkspaceBaseV1,
  type WorkspaceKind,
} from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { sourceContext } from '@/lib/workspace-source/application/context'
import { refusalDiagnostic } from '@/lib/workspace-source/application/errors'
import { kindLimitFinding, overKindLimit } from '@/lib/workspace-source/application/findings'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import { adapterOf } from '@/lib/workspace-source/application/registry'
import type {
  ReadBlob,
  ReadOutcome,
  ReadResource,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export interface ReadWorkspaceSourceInput {
  workspaceId: string
  /** The kinds to read; every kind this server supports when omitted. */
  kinds?: WorkspaceKind[]
}

export interface ReadWorkspaceSourceResult {
  workspaceId: string
  /**
   * The kinds read (a kind the caller may not load, or one over its limit, is left out): the
   * directory manages these.
   */
  kinds: WorkspaceKind[]
  /** Workspace-relative path → text. */
  files: Record<string, string>
  blobs: ReadBlob[]
  base: WorkspaceBaseV1
  /** Resources left out, with why (too large to read as source, or not readable by the caller). */
  skipped: Array<{ kind: WorkspaceKind; key: string; reason: string }>
  diagnostics: WorkspaceSourceDiagnostic[]
}

/** The byte budgets of one directory, by the budget each file counts against. */
type DirectoryBudgets = Record<SourceBudget, number>

const SOURCE_BUDGETS = [
  'declaration',
  'workflow',
  'rows',
] as const satisfies readonly SourceBudget[]

/**
 * What one directory may hold across kinds, so anything a get writes applies back and one get
 * holds a bounded amount: declaration bytes (the text every codec counts against the declaration
 * budget), workflow bytes (each workflow is also held to its own limits when read), table rows
 * bytes and listed blobs. A resource that would take the directory past any of them is left out
 * and listed in `skipped`, in apply order, so earlier kinds are kept whole.
 */
function directoryBudget() {
  const { maxDeclarationBytes, maxDirectoryWorkflowBytes, maxRowsBytes, maxBlobs } =
    WORKSPACE_SOURCE_LIMITS
  const limits: DirectoryBudgets = {
    declaration: maxDeclarationBytes,
    workflow: maxDirectoryWorkflowBytes,
    rows: maxRowsBytes,
  }
  const spent: DirectoryBudgets = { declaration: 0, workflow: 0, rows: 0 }
  let blobs = 0
  return {
    spend(kind: WorkspaceKind, read: { text: Record<string, string>; blobs: ReadBlob[] }) {
      const bytes: DirectoryBudgets = { declaration: 0, workflow: 0, rows: 0 }
      for (const [path, text] of Object.entries(read.text)) {
        bytes[budgetOfPath(adapterOf(kind).codec, path)] += utf8ByteLength(text)
      }
      for (const budget of SOURCE_BUDGETS) {
        if (spent[budget] + bytes[budget] > limits[budget]) {
          return `its ${budget} would take the directory past the ${limits[budget]}-byte ${budget} limit`
        }
      }
      if (blobs + read.blobs.length > maxBlobs) {
        return `its binary files would take the directory past the ${maxBlobs}-file limit`
      }
      for (const budget of SOURCE_BUDGETS) spent[budget] += bytes[budget]
      blobs += read.blobs.length
      return null
    },
  }
}

/**
 * Resources a get reads together: a kind that reads in batches reads this many at once, and each
 * batch is spent against the budget and dropped before the next, so a get never holds a whole
 * kind's reads (every workflow's stored graph and printed text) at once.
 */
const READ_CHUNK = 25

/**
 * One resource's read: from the kind's batched read when it ran (its failure, or the resource's
 * own error, is that resource's), else read alone.
 */
async function readOne(
  batch: { reads: Map<string, ReadOutcome> } | { error: unknown } | undefined,
  key: string,
  read: () => Promise<ReadResource>
): Promise<ReadResource> {
  if (batch === undefined) return read()
  if ('error' in batch) throw batch.error
  const outcome = batch.reads.get(key)
  if (!outcome) return read()
  if ('error' in outcome) throw outcome.error
  return outcome.read
}

/**
 * Reads a workspace as source: for each requested kind, every stored resource printed as the
 * files `sim workspaces source get` writes, plus the base that binds each key to its id. Each
 * resource is read through the use case that owns it. Like a workflow source get, the one write
 * is key allocation for resources that have no key yet. A kind the caller may not read, or that
 * holds too many, is reported and skipped; a resource that cannot be read as source or would take
 * the directory past its limits is listed in `skipped`.
 */
export const readWorkspaceSource = defineAuthorizedWorkspaceUseCase({
  operation: workspaceSourceOperations.read,
  resolveContext: ({ input }: { input: ReadWorkspaceSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ReadWorkspaceSourceResult> {
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
    // Kinds left out: the caller may not load them, or the workspace holds too many.
    const unread = new Set<WorkspaceKind>()
    for (const kind of kinds) {
      const adapter = adapterOf(kind)
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
      const readResources: typeof stored.unbound = []
      for (const chunk of chunkArray([...stored.bound], READ_CHUNK)) {
        const batch = adapter.readMany
          ? await adapter
              .readMany(
                chunk.map(([, resource]) => resource),
                ctx
              )
              .then(
                (reads) => ({ reads }),
                (error: unknown) => ({ error })
              )
          : undefined
        for (const [key, resource] of chunk) {
          try {
            const read = await readOne(batch, key, () => adapter.read(resource, ctx))
            const over = budget.spend(kind, read)
            if (over) {
              result.skipped.push({ kind, key, reason: over })
              continue
            }
            Object.assign(result.files, read.text)
            result.blobs.push(...read.blobs)
            result.base.resources[resourceAddress(kind, key)] = read.base
            result.diagnostics.push(...(read.diagnostics ?? []))
            readResources.push(resource)
          } catch (error) {
            const finding = refusalDiagnostic(error, { kind, key })
            result.skipped.push({ kind, key, reason: finding.message })
          }
        }
      }
      // A kind one root file declares whole prints that file once, from every resource read.
      if (adapter.printAll) Object.assign(result.files, adapter.printAll(readResources))
    }
    result.kinds = kinds.filter((kind) => !unread.has(kind))
    return result
  },
})
