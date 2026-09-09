import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { assertFolderMutable } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { capabilityGovernedPrincipalUserId } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import { loadActiveFolderPathIndex, resolveFolderPathFromIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type {
  ImportWorkflowInput,
  ImportWorkflowResult,
} from '@/lib/workflows/application/import-export'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  resolveWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'
import { resolveImportedMetadata } from '@/lib/workflows/operations/import-workflow'
import { createWorkflowInTransaction } from '@/lib/workflows/orchestration/workflow-lifecycle'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { admitWorkflowState, saveAdmittedWorkflowState } from '@/lib/workflows/persistence/utils'
import {
  authorizeWorkflowBindingCredentials,
  validateFinalWorkflowBindingTargets,
  validateWorkflowBindingTargets,
} from '@/lib/workflows/references/binding-targets'
import { regenerateImportedVariableIds } from '@/lib/workflows/references/finalize-import'
import { finalizeBlockToolPositions } from '@/lib/workflows/references/finalize-tool-positions'
import {
  inspectImportConfiguration,
  publicImportConfiguration,
  validateImportSelectorValues,
} from '@/lib/workflows/references/import-configuration'
import { buildWorkflowImportPlan } from '@/lib/workflows/references/import-plan'
import {
  assertImportedInlineToolTitlesAvailable,
  insertImportedInlineTools,
  prepareImportedInlineTools,
} from '@/lib/workflows/references/inline-tools'
import { assertWorkflowPreviewFits } from '@/lib/workflows/references/preview-limits'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'
import {
  findWorkspaceOperationReceipt,
  insertWorkspaceOperationReceipt,
  lockWorkspaceOperationRequest,
  type WorkspaceOperationReport,
  withWorkspaceOperationReplay,
  workflowOperationFingerprint,
} from '@/lib/workspaces/operations/receipts'
import { regenerateWorkflowIds } from '@/stores/workflows/utils'

function previewInput(input: ImportWorkflowInput) {
  let workflowInput: unknown = input.workflow
  if (typeof workflowInput === 'string') {
    try {
      workflowInput = JSON.parse(workflowInput)
    } catch {
      throw new OrchestrationError('validation', 'Workflow must contain valid JSON')
    }
  }
  return {
    workspaceId: input.workspaceId,
    folderPath: input.folderPath ?? '/',
    name: input.name,
    description: input.description,
    workflow: workflowInput,
    mappings: input.mappings ?? [],
    bindings: input.bindings ?? [],
    dependentValues: input.dependentValues ?? [],
  }
}

async function prepareMappedImport(principal: Principal, input: ImportWorkflowInput) {
  const resolution = await resolveWorkflowFolderPath(input.workspaceId, input.folderPath ?? '/')
  await assertFolderMutable(resolution.folderId)
  const plan = buildWorkflowImportPlan(input.workflow, input)
  const configuration = await inspectImportConfiguration(plan, input, input.workspaceId)
  assertWorkflowPreviewFits({
    bindings: plan.bindings,
    unresolvedBindings: plan.unresolvedBindings,
    configuration,
  })
  await authorizeWorkflowBindingCredentials(principal, input.workspaceId, plan)
  const targets = await validateWorkflowBindingTargets(db, input.workspaceId, plan)
  const finalTargets = await validateFinalWorkflowBindingTargets(db, input.workspaceId, plan)
  await validateImportSelectorValues(principal, input.workspaceId, configuration, input)
  await admitWorkflowState(plan.state, {
    workspaceId: input.workspaceId,
    subjectUserId: capabilityGovernedPrincipalUserId(principal),
  })
  const inlineTools = prepareImportedInlineTools(structuredClone(plan.state))
  await assertImportedInlineToolTitlesAvailable(db, input.workspaceId, inlineTools)
  const fingerprintInput = {
    input: previewInput(input),
    folderId: resolution.folderId,
    state: plan.state,
    targets,
    finalTargets,
    configuration,
  }
  return {
    resolution,
    plan,
    configuration: publicImportConfiguration(configuration),
    fingerprintInput,
    fingerprint: workflowOperationFingerprint(fingerprintInput),
  }
}

export const previewWorkflowImport = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.importPreview,
  resolveContext: ({ input }: { input: ImportWorkflowInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input }) {
    const prepared = await prepareMappedImport(principal, input)
    const preview = {
      previewFingerprint: prepared.fingerprint,
      ready:
        prepared.plan.unresolvedBindings.length === 0 &&
        !prepared.configuration.some((field) => field.required && !field.configured),
      bindings: prepared.plan.bindings,
      unresolvedBindings: prepared.plan.unresolvedBindings,
      configuration: prepared.configuration,
      unresolvedConfiguration: prepared.configuration.filter(
        (field) => field.required && !field.configured
      ),
      discovery: [
        {
          kind: 'credential',
          command: 'sim credentials list --workspace <destination>',
          humanAuthorizationMayBeRequired: true,
        },
        {
          kind: 'selector',
          command:
            'sim selectors list --workspace <destination> --selector-key <key> --context @context.json',
          humanAuthorizationMayBeRequired: false,
        },
      ],
    }
    assertWorkflowPreviewFits(preview)
    return preview
  },
})

function receiptResult(report: WorkspaceOperationReport, replayed: boolean): ImportWorkflowResult {
  const imported = report.importedWorkflow
  if (!imported) throw new OrchestrationError('internal', 'Import receipt is missing its result')
  return {
    workflow: {
      ...imported,
      createdAt: new Date(imported.createdAt),
      updatedAt: new Date(imported.updatedAt),
    },
    folderPath: imported.folderPath,
    operation: report,
    replayed,
  }
}

/** Called inside the authorized import operation; every business write shares this transaction. */
export async function applyMappedWorkflowImport(
  principal: Principal,
  input: ImportWorkflowInput,
  context: ActiveWorkspaceApplicationContext
): Promise<ImportWorkflowResult> {
  if (!input.requestId || !input.previewFingerprint)
    throw new WorkflowImportError(
      'validation',
      'Mapped imports require requestId and previewFingerprint'
    )
  const requestId = input.requestId
  const requestHash = workflowOperationFingerprint({
    ...previewInput(input),
    previewFingerprint: input.previewFingerprint,
  })
  return withWorkspaceOperationReplay(
    { workspaceId: context.workspaceId, requestId, requestHash },
    (receipt) => receiptResult(receipt, true),
    async () => {
      const prepared = await prepareMappedImport(principal, input)
      if (
        prepared.plan.unresolvedBindings.length ||
        prepared.configuration.some((field) => field.required && !field.configured)
      )
        throw new WorkflowImportError('conflict', 'Import requires resource configuration', {
          applied: false,
          requestId,
          reason: 'requires_configuration',
          unresolvedBindings: prepared.plan.unresolvedBindings,
          unresolvedConfiguration: prepared.configuration.filter(
            (field) => field.required && !field.configured
          ),
        })
      if (prepared.fingerprint !== input.previewFingerprint)
        throw new WorkflowImportError('conflict', 'Import preview is stale', {
          applied: false,
          requestId,
          reason: 'stale_preview',
          previewFingerprint: prepared.fingerprint,
        })
      const importState = structuredClone(prepared.plan.state)
      const variableIdMap = regenerateImportedVariableIds(importState)
      const inlineTools = prepareImportedInlineTools(importState)
      for (const block of Object.values(importState.blocks)) finalizeBlockToolPositions(block)
      const regenerated = regenerateWorkflowIds(importState, { clearTriggerRuntimeValues: true })
      const edgeIdMap = new Map(
        importState.edges.flatMap((edge, index) =>
          edge.id ? [[edge.id, regenerated.edges[index].id] as const] : []
        )
      )
      const normalized = prepareWorkflowStateForPersistence(regenerated).state
      const admitted = await admitWorkflowState(
        { ...regenerated, ...normalized },
        {
          workspaceId: context.workspaceId,
          subjectUserId: capabilityGovernedPrincipalUserId(principal),
        }
      )
      const metadata = resolveImportedMetadata(
        previewInput(input).workflow,
        input.name,
        input.description
      )
      const attribution = resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      })
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '10s'`)
        await lockWorkspaceOperationRequest(tx, context.workspaceId, requestId)
        const replay = await findWorkspaceOperationReceipt(
          tx,
          context.workspaceId,
          requestId,
          requestHash
        )
        if (replay) return receiptResult(replay, true)
        await acquireFolderMutationLock(tx, context.workspaceId, 'workflow')
        const [active] = await tx
          .select({ id: workspace.id })
          .from(workspace)
          .where(and(eq(workspace.id, context.workspaceId), isNull(workspace.archivedAt)))
          .for('update')
        if (!active) throw new OrchestrationError('not_found', 'Workspace not found')
        const folderIndex = await loadActiveFolderPathIndex(context.workspaceId, 'workflow', tx, {
          maxRows: MAX_FOLDERS_PER_WORKSPACE,
        })
        const folderId = resolveFolderPathFromIndex(folderIndex, input.folderPath ?? '/')
        if (folderId === undefined || folderId !== prepared.resolution.folderId)
          throw new WorkflowImportError('conflict', 'Destination folder changed after preview', {
            applied: false,
            requestId,
            reason: 'stale_preview',
          })
        let ancestorId = folderId
        while (ancestorId) {
          const ancestor = folderIndex.rowById.get(ancestorId)!
          if (ancestor.locked)
            throw new OrchestrationError('locked', 'Destination folder is locked')
          ancestorId = ancestor.parentId
        }
        const targets = await validateWorkflowBindingTargets(
          tx,
          context.workspaceId,
          prepared.plan,
          {
            lock: true,
          }
        )
        const finalTargets = await validateFinalWorkflowBindingTargets(
          tx,
          context.workspaceId,
          prepared.plan,
          { lock: true }
        )
        if (
          workflowOperationFingerprint({ ...prepared.fingerprintInput, targets, finalTargets }) !==
          input.previewFingerprint
        )
          throw new WorkflowImportError('conflict', 'Import preview is stale', {
            applied: false,
            requestId,
            reason: 'stale_preview',
          })
        const created = await createWorkflowInTransaction(tx, {
          ...metadata,
          workspaceId: context.workspaceId,
          folderId: prepared.resolution.folderId,
          userId: attribution.attributedUserId,
          deduplicate: true,
        })
        await insertImportedInlineTools(
          tx,
          context.workspaceId,
          attribution.attributedUserId,
          inlineTools
        )
        const saved = await saveAdmittedWorkflowState(tx, created.id, admitted)
        if (!saved.success)
          throw new OrchestrationError('internal', 'Failed to persist imported workflow')
        await tx
          .update(workflow)
          .set({ variables: admitted.state.variables ?? {} })
          .where(eq(workflow.id, created.id))
        const report: WorkspaceOperationReport = {
          operationId: generateId(),
          requestId,
          workspaceId: context.workspaceId,
          kind: 'workflow_import',
          applied: true,
          status: 'completed',
          resourceIds: [created.id, ...inlineTools.map((tool) => tool.id)],
          issues: [],
          idMap: Object.fromEntries([...regenerated.idMap, ...edgeIdMap, ...variableIdMap]),
          importedWorkflow: {
            id: created.id,
            name: created.name,
            description: created.description,
            workspaceId: created.workspaceId,
            folderId: created.folderId,
            sortOrder: created.sortOrder,
            folderPath: workflowFolderPathForId(folderIndex, created.folderId),
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          },
        }
        await insertWorkspaceOperationReceipt(tx, requestHash, report)
        await enqueueOutboxEvent(tx, 'workspace.workflows.changed', {
          workspaceId: context.workspaceId,
        })
        return receiptResult(report, false)
      })
    }
  )
}
