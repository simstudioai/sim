import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  canonicalHash,
  type Diagnostic,
  type SourceBase,
  type SourceFingerprint,
  sourceDepthOverflow,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import {
  SOURCE_LIMITS,
  type SourceLimitExcess,
  sourceLimitExcesses,
} from '@sim/workflow-code/limits'
import { readWorkflowSourceMeta } from '@sim/workflow-persistence/source-meta'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import { printStoredSource } from '@/lib/workflows/code/apply/print'
import { buildSourceCatalog } from '@/lib/workflows/code/catalog/workspace'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { canonicalizeStored } from '@/lib/workflows/code/stored-canonical'

interface GetWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** `files` (default): function code in `functions/*` files; `inline`: tagged templates. */
  functionCode?: 'inline' | 'files'
}

/** A canonicalize or print finding, without source spans (the read path has no input text). */
interface WorkflowSourceReadDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  hint?: string
  blockKey?: string
  param?: string
}

interface ReadWorkflowSourceResult {
  workflowId: string
  workspaceId: string
  /** Repo-relative path → text: `workflow.ts` first, then any function-code files. */
  files: Record<string, string>
  lock: WorkflowLockV1
  base: SourceBase
  /** `sf1:` freshness token; apply answers 409 when the stored graph no longer matches it. */
  fingerprint: SourceFingerprint
  /** Hash of the canonical model the files compile to (annotations excluded). */
  canonicalHash: string
  /** The source catalog's content hash the files were printed against. */
  catalogHash: string
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
function assertFitsSourceLimits(files: Record<string, string>, blockCount: number): void {
  const excesses = sourceLimitExcesses(files, blockCount)
  if (excesses.length > 0) {
    throw new OrchestrationError(
      'payload_too_large',
      `This workflow is too large to read as source: ${excesses.map(describeExcess).join('; ')}.`
    )
  }
  const tooDeep = sourceDepthOverflow(files)
  if (tooDeep !== null) {
    throw new OrchestrationError(
      'payload_too_large',
      `This workflow is too deeply nested to read as source: ${tooDeep} nests deeper than ${SOURCE_LIMITS.maxDepth} levels.`
    )
  }
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
    await requireWorkflowCodeEnabled()
    const [graph, gate, sourceMeta] = await Promise.all([
      loadWorkflowGraph(context),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      readWorkflowSourceMeta(db, context.workflowId),
    ])
    const { blocks, edges, loops, parallels, variables } = graph
    const blockCount = Object.keys(blocks).length
    assertFitsSourceLimits({}, blockCount)
    const state = { blocks, edges, loops, parallels, variables }
    const meta = { name: context.workflow.name, description: context.workflow.description ?? null }
    const { catalog } = await withCatalogBlockScope(gate, async () =>
      buildSourceCatalog({
        gate,
        organizationId: context.workspaceOrganizationId,
        storedTypes: [...new Set(Object.values(blocks).map((block) => block.type))],
      })
    )
    const { canonical, resources } = await canonicalizeStored({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      state,
      meta,
      catalog,
      createdBy: resolvePrincipalSubjectUserId(principal) ?? null,
    })
    const printed = printStoredSource({
      state,
      meta,
      catalog,
      resources,
      sourceMeta,
      functionCode: input.functionCode ?? 'files',
      lockless: canonical,
    })
    assertFitsSourceLimits(printed.files, blockCount)
    return {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      files: printed.files,
      lock: printed.lock,
      base: {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        fingerprint: printed.fingerprint,
        catalogHash: catalog.hash,
      },
      fingerprint: printed.fingerprint,
      canonicalHash: canonicalHash(canonical.workflow),
      catalogHash: catalog.hash,
      sdkMajor: catalog.sdkMajor,
      blockTypes: usedBlockTypes(canonical.workflow),
      diagnostics: [...canonical.diagnostics, ...printed.diagnostics].map(toReadDiagnostic),
    }
  },
})
