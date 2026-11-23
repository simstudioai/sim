import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  type Diagnostic,
  type SourceBase,
  type SourceFingerprint,
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
import type { WorkflowState } from '@sim/workflow-types/workflow'
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
import { recordSourceRead } from '@/lib/workflows/application/source-analytics'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import { buildSourceCatalog, storedCatalogTypes } from '@/lib/workflows/code/catalog/workspace'
import {
  type PrintedSource,
  printStoredSource,
  type StoredSource,
  storedCanonicalHash,
  storedSourceFingerprint,
} from '@/lib/workflows/code/print-stored'
import {
  canonicalizeStored,
  type PrefetchedStoredResources,
  prefetchStoredResources,
  prefetchStoredResourcesFor,
  type StoredCanonical,
} from '@/lib/workflows/code/stored-canonical'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

interface GetWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** `files` (default): function code in `functions/*` files; `inline`: tagged templates. */
  functionCode?: 'inline' | 'files'
  /**
   * A plan's read (never a route's): a resource with no key stays unkeyed instead of binding one,
   * and no source read is recorded, so a plan writes nothing.
   */
  plan?: boolean
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
    case 'maxVariables':
      return `it has ${excess.actual} variables, over the ${excess.max}-variable limit`
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
  counts: { blocks: number; edges: number; variables: number }
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

/**
 * Runs `use` on `stored` canonicalized against its source catalog and resource keys, inside the
 * gate's custom block scope: the one canonicalization a source read prints and a fingerprint check
 * hashes, so the two cannot disagree.
 */
function withStoredCanonical<R>(
  loaded: {
    organizationId: string | null
    gate: CatalogGate
    prefetched: PrefetchedStoredResources
    stored: StoredSource
  },
  use: (canonical: StoredCanonical, catalog: ReturnType<typeof buildSourceCatalog>) => Promise<R>
): Promise<R> {
  const { gate, prefetched, stored } = loaded
  return withCatalogBlockScope(gate, async () => {
    const catalog = buildSourceCatalog({
      gate,
      organizationId: loaded.organizationId,
      storedTypes: storedCatalogTypes(Object.values(stored.state.blocks)),
    })
    const canonical = await canonicalizeStored({ prefetched, ...stored, catalog })
    return use(canonical, catalog)
  })
}

/**
 * The `sf1:` fingerprint a source read of `draft` would report as `base.fingerprint`: `draft` is a
 * graph of the workflow in `context` as the normalized tables load it (a deploy's snapshot), read
 * under the workflow's current name and description. A caller holding the fingerprint an apply
 * answered with tells from it whether `draft` is still the draft that apply wrote. Writes nothing:
 * a resource with no key yet stays unkeyed (a draft holding one is not the draft any read printed).
 */
export async function draftSourceFingerprint(
  principal: Principal,
  context: ActiveWorkflowApplicationContext,
  draft: Pick<WorkflowState, 'blocks' | 'edges' | 'loops' | 'parallels' | 'variables'>
): Promise<SourceFingerprint> {
  const [gate, prefetched] = await Promise.all([
    resolveCatalogGate(principal, context, { customBlockInputs: true }),
    prefetchStoredResources({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      createdBy: resolvePrincipalSubjectUserId(principal) ?? null,
      allocate: false,
    }),
  ])
  const state = {
    blocks: draft.blocks,
    edges: draft.edges,
    loops: draft.loops,
    parallels: draft.parallels,
    variables: parseWorkflowVariables(draft.variables) ?? {},
  }
  const meta = { name: context.workflow.name, description: context.workflow.description ?? null }
  return withStoredCanonical(
    { organizationId: context.workspaceOrganizationId, gate, prefetched, stored: { state, meta } },
    async ({ canonical, resources }) => storedSourceFingerprint(canonical, resources)
  )
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
  const counts = {
    blocks: Object.keys(state.blocks).length,
    edges: state.edges.length,
    variables: Object.keys(state.variables ?? {}).length,
  }
  assertFitsSourceLimits({ files: {}, entryDepth: 0 }, counts)
  return withStoredCanonical(
    { organizationId: scope.workspaceOrganizationId, gate, prefetched, stored: loaded.stored },
    async ({ canonical, resources }, catalog) => {
      const canonicalHash = storedCanonicalHash(canonical, resources)
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
    }
  )
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
  resolveContext: resolvePrincipalWorkflowContext<GetWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<ReadWorkflowSourceResult> {
    const [stored, gate, sourceMeta, prefetched] = await Promise.all([
      loadStoredSource(context),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      readWorkflowSourceMeta(db, context.workflowId),
      prefetchStoredResources({
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        createdBy: resolvePrincipalSubjectUserId(principal) ?? null,
        ...(input.plan ? { allocate: false } : {}),
      }),
    ])
    const read = await printLoadedSource(
      { scope: context, stored, gate, sourceMeta, prefetched },
      input.functionCode ?? 'files'
    )
    if (!input.plan) recordSourceRead(principal, context)
    return read
  },
})

/**
 * The `sf1:` fingerprint of the workflow's stored draft ({@link draftSourceFingerprint}), for a
 * caller that needs only to tell whether the draft is one it vouches for (a workspace plan's
 * deployment). Prints nothing, so no source limit applies, and records and writes nothing.
 */
export const readDraftFingerprint = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readSource,
  resolveContext: resolvePrincipalWorkflowContext<{ workflowId: string }>,
  async execute({ principal, context }): Promise<SourceFingerprint> {
    const { state } = await loadStoredSource(context)
    return draftSourceFingerprint(principal, context, state)
  },
})

interface ReadWorkflowSourcesInput {
  workspaceId: string
  /** Workflows of the workspace to read; one archived or in another workspace reads as missing. */
  workflowIds: readonly string[]
  /** A plan's read: a resource with no key stays unkeyed instead of binding one. */
  plan?: boolean
}

/** Workflows a batched read prints at once: each may wait on its own resolver queries. */
const PRINT_CONCURRENCY = 8

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
  resolveContext: ({ input }: { input: ReadWorkflowSourcesInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<Map<string, WorkflowSourceRead>> {
    const { workspaceId } = context
    const createdBy = resolvePrincipalSubjectUserId(principal) ?? null
    const [graphs, gate, sourceMetas, prefetched] = await Promise.all([
      loadWorkflowGraphs(workspaceId, input.workflowIds),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      readWorkflowSourceMetas(db, input.workflowIds),
      prefetchStoredResourcesFor(
        { workspaceId, createdBy, ...(input.plan ? { allocate: false } : {}) },
        input.workflowIds
      ),
    ])
    const printed = await mapWithConcurrency(
      input.workflowIds,
      PRINT_CONCURRENCY,
      async (workflowId): Promise<WorkflowSourceRead> => {
        const loaded = graphs.get(workflowId)
        if (!loaded) return { error: new OrchestrationError('not_found', 'Workflow not found') }
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
          return { source }
        } catch (error) {
          if (!(error instanceof OrchestrationError)) throw error
          return { error }
        }
      }
    )
    return new Map(input.workflowIds.map((workflowId, index) => [workflowId, printed[index]]))
  },
})
