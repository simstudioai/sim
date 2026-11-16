import { db } from '@sim/db'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  type CodeComment,
  canonicalHash,
  type Diagnostic,
  encodeAnchor,
  type LockBase,
  type LockIdentity,
  printWorkflow,
  type SourceFingerprint,
  sourceFingerprint,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { readWorkflowCodeMeta } from '@sim/workflow-persistence/code-meta'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import { buildCodeCatalog } from '@/lib/workflows/code/catalog/workspace-catalog'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { buildLockFromState, codeMetaPrintInputs } from '@/lib/workflows/code/source-lock'
import { canonicalizeStored } from '@/lib/workflows/code/stored-canonical'

/** Directory function-code files are printed into when `functionCode` is `files`. */
const FUNCTION_CODE_DIR = 'functions'

interface GetWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** Prints each block's id as a trailing comment on its declaration (agent read path). */
  annotateIds?: boolean
  /** `files` (default): function code in `functions/*` files; `inline`: tagged templates. */
  functionCode?: 'inline' | 'files'
}

/** A canonicalize or print finding, without source spans (the read path has no input text). */
interface WorkflowSourceWarning {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  hint?: string
  blockKey?: string
  param?: string
}

interface GetWorkflowSourceResult {
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
  /** Block types the source uses, as blocks or as agent tools, sorted; for SDK type generation. */
  blockTypes: string[]
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

/**
 * Reads a workflow's stored draft as TypeScript source (build-spec decisions 11–13, s4 §2).
 *
 * Loads the stored, migrated graph; builds the per-workflow compile catalog (the blocks this
 * caller may place plus every type already in the workflow); projects the graph to the canonical
 * model with resource ids lifted to provisional keys; and prints it with the bindings, order and
 * comments the workflow's code metadata keeps, so the lock comes from the same place. The catalog
 * comes from the process cache and the stored graph is canonicalized once. Pure read: no audit, so
 * it stays head-safe and pollable like `GET /state`.
 */
export const getWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readSource,
  resolveContext: resolvePrincipalWorkflowContext<GetWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<GetWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    const [graph, gate, codeMeta] = await Promise.all([
      loadWorkflowGraph(context),
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      readWorkflowCodeMeta(db, context.workflowId),
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

    const { canonical } = await canonicalizeStored({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      state,
      meta,
      catalog,
    })

    const metaInputs = codeMetaPrintInputs(codeMeta, canonical)
    const withComments: CanonicalWorkflow = {
      ...canonical.workflow,
      annotations: {
        ...canonical.workflow.annotations,
        comments: { ...canonical.workflow.annotations.comments, ...metaInputs.comments },
      },
    }
    const printed = printWorkflow({
      workflow: input.annotateIds ? withIdComments(withComments, canonical.identity) : withComments,
      catalog,
      hints: metaInputs.hints,
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
      lock: buildLockFromState(codeMeta, canonical, printed.hints),
      lockBase: {
        workspaceId: context.workspaceId,
        baseFingerprint: fingerprint,
        catalogHash: catalog.hash,
      },
      fingerprint,
      canonicalHash: canonicalHash(canonical.workflow),
      catalogVersion: catalog.hash,
      sdkMajor: catalog.sdkMajor,
      blockTypes: usedBlockTypes(canonical.workflow),
      warnings: [...canonical.diagnostics, ...printed.diagnostics].map(toWarning),
    }
  },
})
