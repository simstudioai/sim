import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  type Diagnostic,
  type SourceBase,
  sourceDepthOverflow,
  type WorkflowLockV1,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import {
  SOURCE_LIMITS,
  type SourceLimitExcess,
  sourceLimitExcesses,
} from '@sim/workflow-code/limits'
import {
  readWorkflowSourceMeta,
  readWorkflowSourceMetas,
} from '@sim/workflow-persistence/source-meta'
import {
  type CatalogGate,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/context'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import {
  loadWorkflowGraph,
  loadWorkflowGraphs,
} from '@/lib/workflows/application/read-workflow-graph'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import { buildSourceCatalog, storedCatalogTypes } from '@/lib/workflows/code/catalog/workspace'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import {
  type PrintedSource,
  printStoredSource,
  type StoredSource,
  storedCanonicalHash,
} from '@/lib/workflows/code/print-stored'
import {
  canonicalizeStored,
  type PrefetchedStoredResources,
  prefetchStoredResources,
  prefetchStoredResourcesFor,
} from '@/lib/workflows/code/stored-canonical'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

interface GetWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** `files` (default): function code in `functions/*` files; `inline`: tagged templates. */
  functionCode?: 'inline' | 'files'
}

/** A canonicalize or print finding, without source spans (the read path has no input text). */
type WorkflowSourceReadDiagnostic = Pick<
  WorkflowSourceDiagnostic,
  'code' | 'severity' | 'message' | 'hint' | 'blockKey' | 'param'
>

export interface ReadWorkflowSourceResult {
  workflowId: string
  workspaceId: string
  /** Repo-relative path → text: `workflow.ts` first, then any function-code files. */
  files: Record<string, string>
  lock: WorkflowLockV1
  /** Where the files were read: the `sf1:` fingerprint apply checks and the catalog hash. */
  base: SourceBase
  /** Hash of the canonical model the files compile to (annotations excluded). */
  canonicalHash: string
  sdkMajor: number
  /** Block types the source uses, as blocks or as agent tools, sorted; for SDK type generation. */
  blockTypes: string[]
  diagnostics: WorkflowSourceReadDiagnostic[]
}

function toReadDiagnostic(diagnostic: Diagnostic): WorkflowSourceReadDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.hint !== undefined ? { hint: diagnostic.hint } : {}),
    ...(diagnostic.blockKey !== undefined ? { blockKey: diagnostic.blockKey } : {}),
    ...(diagnostic.param !== undefined ? { param: diagnostic.param } : {}),
  }
}

function usedBlockTypes(workflow: CanonicalWorkflow): string[] {
  const types = new Set<string>()
  for (const block of Object.values(workflow.blocks)) {
    types.add(block.type)
    for (const param of Object.values(block.params)) {
      if (param.kind === 'tools') for (const tool of param.tools) types.add(tool.type)
    }
  }
  return [...types].sort(compareStrings)
}

function describeExcess(excess: SourceLimitExcess): string {
  switch (excess.limit) {
    case 'maxBlocks':
      return `it has ${excess.actual} blocks, over the ${excess.max}-block limit`
    case 'maxEdges':
      return `it has ${excess.actual} connections, over the ${excess.max}-connection limit`
    case 'maxFiles':
      return `it prints ${excess.actual} files, over the ${excess.max}-file limit`
    case 'maxTotalBytes':
      return `its files total ${excess.actual} bytes, over the ${excess.max}-byte limit`
  }
}

/**
 * Refuses (413) a source an apply would reject for its size or nesting, so every get can be
 * applied back unchanged. The message names each measured size against its limit, or the file
 * nested too deeply.
 */
function assertFitsSourceLimits(
  source: Pick<PrintedSource, 'files' | 'entryDepth'>,
  counts: { blocks: number; edges: number }
): void {
  const excesses = sourceLimitExcesses(source.files, counts)
  if (excesses.length > 0) {
    throw new OrchestrationError(
      'payload_too_large',
      `This workflow is too large to read as source: ${excesses.map(describeExcess).join('; ')}.`
    )
  }
  const tooDeep = sourceDepthOverflow(source.files, source.entryDepth)
  if (tooDeep !== null) {
    throw new OrchestrationError(
      'payload_too_large',
      `This workflow is too deeply nested to read as source: ${tooDeep} nests deeper than ${SOURCE_LIMITS.maxDepth} levels.`
    )
  }
}

/** The stored draft and the row fields its canonical `meta` carries; apply loads it the same way. */
export async function loadStoredSource(
  context: ActiveWorkflowApplicationContext
): Promise<StoredSource> {
  const { blocks, edges, loops, parallels, variables } = await loadWorkflowGraph(context)
  return {
    state: { blocks, edges, loops, parallels, variables },
    meta: { name: context.workflow.name, description: context.workflow.description ?? null },
  }
}

/** Everything one workflow's source read prints from, loaded by a single or a batched read. */
interface LoadedSource {
  scope: { workflowId: string; workspaceId: string; workspaceOrganizationId: string | null }
  stored: StoredSource
  gate: CatalogGate
  sourceMeta: WorkflowSourceMetaV1 | null
  prefetched: PrefetchedStoredResources
}

/**
 * Prints a loaded workflow as source: builds its catalog, canonicalizes the stored graph with its
 * resource keys and prints it with its source meta, refusing one over `SOURCE_LIMITS`.
 */
async function printLoadedSource(
  loaded: LoadedSource,
  functionCode: 'inline' | 'files'
): Promise<ReadWorkflowSourceResult> {
  const { scope, gate, sourceMeta, prefetched } = loaded
  const { state, meta } = loaded.stored
  const counts = { blocks: Object.keys(state.blocks).length, edges: state.edges.length }
  assertFitsSourceLimits({ files: {}, entryDepth: 0 }, counts)
  return withCatalogBlockScope(gate, async () => {
    const catalog = buildSourceCatalog({
      gate,
      organizationId: scope.workspaceOrganizationId,
      storedTypes: storedCatalogTypes(Object.values(state.blocks)),
    })
    const { canonical, resources } = await canonicalizeStored({ prefetched, state, meta, catalog })
    const canonicalHash = storedCanonicalHash(canonical)
    const printed = printStoredSource({
      state,
      meta,
      catalog,
      resources,
      sourceMeta,
      functionCode,
      lockless: canonical,
    })
    assertFitsSourceLimits(printed, counts)
    return {
      workflowId: scope.workflowId,
      workspaceId: scope.workspaceId,
      files: printed.files,
      lock: printed.lock,
      base: {
        version: 1,
        workflowId: scope.workflowId,
        workspaceId: scope.workspaceId,
        fingerprint: printed.fingerprint,
        catalogHash: catalog.hash,
      },
      canonicalHash,
      sdkMajor: catalog.sdkMajor,
      blockTypes: usedBlockTypes(canonical.workflow),
      diagnostics: [...canonical.diagnostics, ...printed.diagnostics].map(toReadDiagnostic),
    }
  })
}

/**
 * Reads a workflow's stored draft as TypeScript source. Builds the per-workflow source catalog
 * (the blocks this caller may place plus every type already in the workflow), canonicalizes the
 * stored graph once with resource ids lifted to their persisted keys, and prints it with the
 * idents, order and comments of its source meta through the same printer every apply response
 * uses. No audit. The one write is resource-key allocation: the first get that references a
 * resource with no key binds one. That is idempotent identity metadata, so read access may cause it.
 * A workflow over `SOURCE_LIMITS` is refused with `payload_too_large` before anything is printed
 * when its block count alone exceeds them, and after printing when its files' size or nesting do.
 */
export const readWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readSource,
  resolveContext: async (args: { principal: Principal; input: GetWorkflowSourceInput }) => {
    const context = await resolvePrincipalWorkflowContext(args)
    await requireWorkflowCodeEnabled(args.principal, context)
    return context
  },
  async execute({ principal, input, context }): Promise<ReadWorkflowSourceResult> {
    const [stored, gate, sourceMeta, prefetched] = await Promise.all([
      loadStoredSource(context),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      readWorkflowSourceMeta(db, context.workflowId),
      prefetchStoredResources({
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        createdBy: resolvePrincipalSubjectUserId(principal) ?? null,
      }),
    ])
    return printLoadedSource(
      { scope: context, stored, gate, sourceMeta, prefetched },
      input.functionCode ?? 'files'
    )
  },
})

interface ReadWorkflowSourcesInput {
  workspaceId: string
  /** Workflows of the workspace to read; one archived or in another workspace reads as missing. */
  workflowIds: readonly string[]
}

/** One workflow of a batched read: its source, or why it could not be read as source. */
export type WorkflowSourceRead =
  | { source: ReadWorkflowSourceResult }
  | { error: OrchestrationError }

/**
 * {@link readWorkflowSource} for many workflows of one workspace (`functionCode: 'files'`), with
 * what every read loads the same done once: the workspace is authorized once with the same
 * operation, the catalog gate is resolved once, and the graphs, source meta and resource keys of
 * all of them are loaded together. Each workflow's result is its own: one too large to read as
 * source, or missing, is an error for that workflow alone.
 */
export const readWorkflowSources = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readSource,
  resolveContext: async ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkflowSourcesInput
  }) => {
    const context = await resolveActiveWorkspaceApplicationContext(input.workspaceId)
    await requireWorkflowCodeEnabled(principal, context)
    return context
  },
  async execute({ principal, input, context }): Promise<Map<string, WorkflowSourceRead>> {
    const { workspaceId } = context
    const createdBy = resolvePrincipalSubjectUserId(principal) ?? null
    const [graphs, gate, sourceMetas, prefetched] = await Promise.all([
      loadWorkflowGraphs(workspaceId, input.workflowIds),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      readWorkflowSourceMetas(db, input.workflowIds),
      prefetchStoredResourcesFor({ workspaceId, createdBy }, input.workflowIds),
    ])
    const reads = new Map<string, WorkflowSourceRead>()
    for (const workflowId of input.workflowIds) {
      const loaded = graphs.get(workflowId)
      if (!loaded) {
        reads.set(workflowId, { error: new OrchestrationError('not_found', 'Workflow not found') })
        continue
      }
      const { blocks, edges, loops, parallels, variables } = loaded.graph
      try {
        const source = await printLoadedSource(
          {
            scope: {
              workflowId,
              workspaceId,
              workspaceOrganizationId: context.workspaceOrganizationId,
            },
            stored: {
              state: { blocks, edges, loops, parallels, variables },
              meta: { name: loaded.name, description: loaded.description ?? null },
            },
            gate,
            sourceMeta: sourceMetas.get(workflowId) ?? null,
            prefetched: { ...prefetched, workflowId },
          },
          'files'
        )
        reads.set(workflowId, { source })
      } catch (error) {
        if (!(error instanceof OrchestrationError)) throw error
        reads.set(workflowId, { error })
      }
    }
    return reads
  },
})
