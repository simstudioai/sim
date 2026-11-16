import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  canonicalHash,
  type Diagnostic,
  type LockBase,
  type SourceFingerprint,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { readWorkflowCodeMeta } from '@sim/workflow-persistence/code-meta'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import { printStoredSource } from '@/lib/workflows/code/apply/print'
import { buildCodeCatalog } from '@/lib/workflows/code/catalog/workspace-catalog'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { canonicalizeStored } from '@/lib/workflows/code/stored-canonical'

interface GetWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
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
 * Reads a workflow's stored draft as TypeScript source. Builds the per-workflow compile catalog
 * (the blocks this caller may place plus every type already in the workflow), canonicalizes the
 * stored graph once with resource ids lifted to their persisted keys, and prints it with the
 * bindings, order and comments of its `code_meta` through the same printer every apply response
 * uses. No audit. The one write is resource-key allocation: the first get that references a
 * resource with no key binds one. That is idempotent identity metadata, so read access may cause it.
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
    const { blocks, edges, loops, parallels, variables } = graph
    const state = { blocks, edges, loops, parallels, variables }
    const meta = { name: context.workflow.name, description: context.workflow.description ?? null }
    const { catalog } = await withCatalogBlockScope(gate, async () =>
      buildCodeCatalog({
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
      codeMeta,
      functionCode: input.functionCode ?? 'files',
      lockless: canonical,
    })
    return {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      files: printed.files,
      lock: printed.lock,
      lockBase: {
        workspaceId: context.workspaceId,
        baseFingerprint: printed.fingerprint,
        catalogHash: catalog.hash,
      },
      fingerprint: printed.fingerprint,
      canonicalHash: canonicalHash(canonical.workflow),
      catalogVersion: catalog.hash,
      sdkMajor: catalog.sdkMajor,
      blockTypes: usedBlockTypes(canonical.workflow),
      warnings: [...canonical.diagnostics, ...printed.diagnostics].map(toWarning),
    }
  },
})
