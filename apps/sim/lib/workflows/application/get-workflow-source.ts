import {
  type CanonicalWorkflow,
  type CodeComment,
  canonicalHash,
  canonicalize,
  type Diagnostic,
  encodeAnchor,
  type LockBase,
  type LockIdentity,
  type LockLayout,
  printWorkflow,
  type SourceFingerprint,
  sourceFingerprint,
  type WorkflowLockBlock,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import { buildCodeCatalog } from '@/lib/workflows/code/catalog/workspace-catalog'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { createRecordingResolver, loadResourceKeyResolver } from '@/lib/workflows/code/resources'

/** Directory function-code files are printed into when `functionCode` is `files`. */
const FUNCTION_CODE_DIR = 'functions'

export interface GetWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** Prints each block's id as a trailing comment on its declaration (agent read path). */
  annotateIds?: boolean
  /** `files` (default): function code in `functions/*` files; `inline`: tagged templates. */
  functionCode?: 'inline' | 'files'
}

/** A canonicalize or print finding, without source spans (the read path has no input text). */
export interface WorkflowSourceWarning {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  hint?: string
  blockKey?: string
  param?: string
}

export interface GetWorkflowSourceResult {
  workflowId: string
  workspaceId: string
  /** Repo-relative path → text: `workflow.ts` first, then any function-code files. */
  files: Record<string, string>
  lock: WorkflowLockV1
  lockBase: LockBase
  /** `sf1:` freshness token; apply answers 409 when the stored graph no longer matches it. */
  fingerprint: SourceFingerprint
  /** Hash of the canonical model the files compile to (annotations excluded). */
  canonicalHash: string
  /** The compile catalog's content hash the files were printed against. */
  catalogVersion: string
  sdkMajor: number
  warnings: WorkflowSourceWarning[]
}

function toWarning(diagnostic: Diagnostic): WorkflowSourceWarning {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.hint !== undefined ? { hint: diagnostic.hint } : {}),
    ...(diagnostic.blockKey !== undefined ? { blockKey: diagnostic.blockKey } : {}),
    ...(diagnostic.param !== undefined ? { param: diagnostic.param } : {}),
  }
}

/**
 * Adds `// id: <block id>` after every block declaration. Comments are annotations, so the
 * canonical hash and fingerprint are unchanged.
 */
function withIdComments(workflow: CanonicalWorkflow, identity: LockIdentity): CanonicalWorkflow {
  const comments = { ...workflow.annotations.comments }
  for (const [key, block] of Object.entries(identity.blocks)) {
    const anchor = encodeAnchor({ kind: 'block', block: key })
    const idComment: CodeComment = { text: ` id: ${block.id}`, kind: 'line', placement: 'trailing' }
    comments[anchor] = [...(comments[anchor] ?? []), idComment]
  }
  return { ...workflow, annotations: { ...workflow.annotations, comments } }
}

/** The full lock: canonicalize's identity, the printer's bindings/order/code files, and layout. */
export function assembleLock(
  identity: LockIdentity,
  hints: Record<string, { binding?: string; order?: number; codeFile?: string }>,
  layout: Record<string, LockLayout>
): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    const hint = hints[key]
    if (hint?.binding === undefined || hint.order === undefined) {
      throw new Error(`The printer returned no binding or order for block "${key}"`)
    }
    blocks[key] = {
      ...block,
      binding: hint.binding,
      order: hint.order,
      ...(hint.codeFile !== undefined ? { codeFile: hint.codeFile } : {}),
      ...(layout[key] ? { layout: layout[key] } : {}),
    }
  }
  return { lockVersion: 1, blocks, variables: identity.variables }
}

/**
 * Reads a workflow's stored draft as TypeScript source (build-spec decisions 11–13, s4 §2).
 *
 * Loads the stored, migrated graph; builds the per-workflow compile catalog (the blocks this
 * caller may place plus every type already in the workflow); projects the graph to the canonical
 * model with resource ids lifted to provisional keys; and prints it. Pure read: no audit, so it
 * stays head-safe and pollable like `GET /state`.
 */
export const getWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readSource,
  resolveContext: resolvePrincipalWorkflowContext<GetWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<GetWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    const [graph, gate] = await Promise.all([
      loadWorkflowGraph(context),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
    ])
    const state: WorkflowState = {
      blocks: graph.blocks,
      edges: graph.edges,
      loops: graph.loops,
      parallels: graph.parallels,
      variables: graph.variables,
    }
    const storedTypes = [...new Set(Object.values(graph.blocks).map((block) => block.type))]
    const meta = {
      name: context.workflow.name,
      description: context.workflow.description ?? null,
    }

    const catalog = await withCatalogBlockScope(gate, async () => {
      const { catalog } = buildCodeCatalog({
        gate,
        organizationId: context.workspaceOrganizationId,
        storedTypes,
      })
      return catalog
    })

    const recording = createRecordingResolver()
    canonicalize(state, { catalog, meta, resources: recording.resolver })
    const resources = await loadResourceKeyResolver(context.workspaceId, recording.requestedKinds)
    const canonical = canonicalize(state, { catalog, meta, resources })

    const printed = printWorkflow({
      workflow: input.annotateIds
        ? withIdComments(canonical.workflow, canonical.identity)
        : canonical.workflow,
      catalog,
      options:
        (input.functionCode ?? 'files') === 'files'
          ? { functionCode: 'files', codeDir: FUNCTION_CODE_DIR }
          : { functionCode: 'inline' },
    })

    const fingerprint = sourceFingerprint(canonical.workflow, canonical.identity)
    return {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
      lock: assembleLock(canonical.identity, printed.hints.blocks, canonical.layout),
      lockBase: {
        workspaceId: context.workspaceId,
        baseFingerprint: fingerprint,
        catalogHash: catalog.hash,
      },
      fingerprint,
      canonicalHash: canonicalHash(canonical.workflow),
      catalogVersion: catalog.hash,
      sdkMajor: catalog.sdkMajor,
      warnings: [...canonical.diagnostics, ...printed.diagnostics].map(toWarning),
    }
  },
})
