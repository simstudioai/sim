import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { v2ApplyWorkflowOperationsBodySchema } from '@/lib/api/contracts/v2/workflows'
import { buildNotesOperations } from '@/lib/build-notes/application/operations'
import {
  diffFromBaseline,
  loadCurrentBaselineState,
  parseBaseline,
} from '@/lib/build-notes/baseline'
import { isBuildNotesEnabled, requireBuildNotesEnabled } from '@/lib/build-notes/feature-flag'
import {
  createBuildNotesFiles,
  readBaselineText,
  readBuildNotesFileText,
  writeBaseline,
} from '@/lib/build-notes/files'
import { batchHash, notesHash, readBuildNotes } from '@/lib/build-notes/notes'
import { buildNotesPath } from '@/lib/build-notes/paths'
import {
  type BuildNotesRow,
  clearBuildNotesEvaluation,
  getLiveBuildNotesForWorkflow,
  readBuildNotesStates,
  recordBuildNotesEvaluation,
} from '@/lib/build-notes/repository'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ApplyWorkflowOperationsInput,
  applyWorkflowOperations,
} from '@/lib/workflows/application/apply-workflow-operations'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { withWorkflowBlockScope } from '@/lib/workflows/application/block-scope'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
import { requireMutableWorkflow } from '@/lib/workflows/application/mutability'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import {
  hasWorkflowLintIssues,
  listWorkflowLintFindings,
  summarizeWorkflowLintIssues,
} from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import { requireAdmittedWorkspaceFile } from '@/lib/workspace-files/application/admit-file-content'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

interface BuildNotesInput {
  workflowId: string
  assertedWorkspaceId?: string
}

const resolveContext = ({ principal, input }: { principal: Principal; input: BuildNotesInput }) =>
  resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })

const authorizeResource = ({ context }: { context: ActiveWorkflowApplicationContext }) =>
  requireBuildNotesEnabled(context.workspaceOrganizationId)

function paths(workflowId: string) {
  return {
    notes: buildNotesPath(workflowId, 'notes'),
    baseline: buildNotesPath(workflowId, 'baseline'),
  }
}

async function requireNotes(context: ActiveWorkflowApplicationContext): Promise<BuildNotesRow> {
  const notes = await getLiveBuildNotesForWorkflow(context.workspaceId, context.workflowId)
  if (!notes) {
    throw new OrchestrationError(
      'not_found',
      'This workflow has no build notes. Create them with build-notes create.'
    )
  }
  return notes
}

/** Creates a workflow's notes from the template and records the current graph as their baseline. */
export const createBuildNotes = defineAuthorizedWorkflowUseCase({
  operation: buildNotesOperations.create,
  resolveContext,
  authorizeResource,
  async execute({ principal, context }) {
    await requireMutableWorkflow(context.workflowId)
    const files = paths(context.workflowId)
    if (await getLiveBuildNotesForWorkflow(context.workspaceId, context.workflowId)) {
      throw new OrchestrationError('conflict', `${files.notes} already exists`)
    }
    await createBuildNotesFiles({
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      workflowName: context.workflow.name,
      userId: requirePrincipalSubjectUserId(principal),
      baseline: await loadCurrentBaselineState(context.workflowId),
    })
    return { workflowId: context.workflowId, ...files }
  },
})

/** Whether the notes exist, passed evaluation, and may be behind edits made outside the agent. */
export const getBuildNotesStatus = defineAuthorizedWorkflowUseCase({
  operation: buildNotesOperations.status,
  resolveContext,
  authorizeResource,
  async execute({ context }) {
    const notes = await getLiveBuildNotesForWorkflow(context.workspaceId, context.workflowId)
    if (!notes) return { workflowId: context.workflowId, exists: false as const }
    return {
      workflowId: context.workflowId,
      exists: true as const,
      ...paths(context.workflowId),
      evaluated: notes.evaluatedNotesHash !== null,
      /**
       * A hint, from the workflow's save time: true when it was saved after the baseline. A field
       * edit in the editor may not move that time; `changes` is the authority, and a build checks it.
       */
      mayHaveChangedOutsideAgent:
        !notes.baselineWorkflowUpdatedAt ||
        context.workflow.updatedAt > notes.baselineWorkflowUpdatedAt,
    }
  },
})

/** What `evaluate` reports: whether the notes may be built from, and each problem that blocks it. */
export interface EvaluateBuildNotesResult {
  workflowId: string
  notes: string
  passed: boolean
  /** Everything that blocks a build, each a line the agent can act on. */
  problems: string[]
  placeholders: string[]
  openItems: { mark: 'gather' | 'ask'; text: string }[]
  assumedItems: number
  dryRun: {
    operationCount: number
    applied: number
    skipped: unknown[]
    inputValidationErrors: unknown[]
    /** Lint findings the batch would add to the graph; each blocks a build. */
    lint: string[]
    /** Findings the saved graph already has, such as a person's unfinished edit; they block nothing. */
    lintAlreadyInGraph: string[]
  } | null
}

interface BatchReading {
  batch: Pick<ApplyWorkflowOperationsInput, 'operations' | 'blockEnabledChanges' | 'layout'> | null
  problems: string[]
}

/** The batch the notes' operations block holds, parsed as `workflows operations apply` parses it. */
function parseBatch(reading: ReturnType<typeof readBuildNotes>): BatchReading {
  if (reading.operationsError) return { batch: null, problems: [reading.operationsError] }
  const parsed = v2ApplyWorkflowOperationsBodySchema.safeParse(reading.batch)
  if (!parsed.success) {
    return {
      batch: null,
      problems: parsed.error.issues.map(
        (issue) => `Operations block: ${issue.path.join('.') || 'operations'}: ${issue.message}`
      ),
    }
  }
  return {
    batch: {
      operations: parsed.data.operations,
      blockEnabledChanges: parsed.data.setBlockEnabled?.map((change) => ({
        blockId: change.block_id,
        enabled: change.enabled,
      })),
      // Placement only, so it is not part of what evaluation approves.
      layout: parsed.data.layout,
    },
    problems: [],
  }
}

/**
 * The saved graph's lint findings counted by key, from the same lint the apply's dry run reports,
 * so a build is held only for what its batch adds and never for a person's unfinished edit.
 */
async function savedGraphLintFindings(
  principal: Principal,
  context: ActiveWorkflowApplicationContext
): Promise<Map<string, number>> {
  const state = await loadWorkflowDeploymentSnapshot(context.workflowId)
  if (!state) return new Map()
  const lint = await withWorkflowBlockScope(context, () =>
    buildWorkflowLintReport(
      { blocks: state.blocks, edges: state.edges },
      {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        subjectUserId: requirePrincipalSubjectUserId(principal),
      }
    )
  )
  const counts = new Map<string, number>()
  for (const { key } of listWorkflowLintFindings(lint)) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

async function readAdmittedNotes(
  principal: Principal,
  context: ActiveWorkflowApplicationContext,
  notes: BuildNotesRow
): Promise<string> {
  return readBuildNotesFileText(context.workspaceId, notes.notesFileId, {
    admit: (file) => requireAdmittedWorkspaceFile(principal, context.workspaceId, file, 'complete'),
  })
}

/**
 * Reads the notes, dry-runs their operations block through the same use case a build applies
 * it with, and lists what still blocks a build. A pass records which notes and which batch
 * passed; a build must apply exactly that batch while the notes are unchanged.
 */
export const evaluateBuildNotes = defineAuthorizedWorkflowUseCase({
  operation: buildNotesOperations.evaluate,
  resolveContext,
  authorizeResource,
  async execute({ principal, context }): Promise<EvaluateBuildNotesResult> {
    const notes = await requireNotes(context)
    const text = await readAdmittedNotes(principal, context, notes)
    const reading = readBuildNotes(text)
    const { batch, problems } = parseBatch(reading)
    let dryRun: EvaluateBuildNotesResult['dryRun'] = null
    if (batch) {
      const [result, saved] = await Promise.all([
        applyWorkflowOperations.execute({
          principal,
          input: {
            workflowId: context.workflowId,
            assertedWorkspaceId: context.workspaceId,
            ...batch,
            dryRun: true,
          },
        }),
        savedGraphLintFindings(principal, context),
      ])
      const lint: string[] = []
      const lintAlreadyInGraph: string[] = []
      for (const finding of listWorkflowLintFindings(result.lint)) {
        const remaining = saved.get(finding.key) ?? 0
        if (remaining > 0) {
          saved.set(finding.key, remaining - 1)
          lintAlreadyInGraph.push(finding.text)
        } else lint.push(finding.text)
      }
      dryRun = {
        operationCount: result.operationCount,
        applied: result.applied,
        skipped: result.skipped,
        inputValidationErrors: result.inputValidationErrors,
        lint,
        lintAlreadyInGraph,
      }
      if (result.skipped.length) problems.push(`Dry run skipped ${result.skipped.length} item(s)`)
      if (result.inputValidationErrors.length)
        problems.push(
          `Dry run found ${result.inputValidationErrors.length} input validation error(s)`
        )
      for (const finding of dryRun.lint) problems.push(`Lint the batch introduces: ${finding}`)
    }
    for (const placeholder of reading.placeholders)
      problems.push(`Placeholder still open: <<open:${placeholder}>>`)
    for (const item of reading.blockingOpenItems)
      problems.push(`Open item marked [${item.mark}]: ${item.text || '(no text)'}`)
    let passed = batch !== null && problems.length === 0
    // A failing evaluation also withdraws an earlier pass: the latest verdict is the one a build trusts.
    if (passed && batch) {
      const recorded = await recordBuildNotesEvaluation(
        notes.id,
        { evaluatedNotesHash: notesHash(text), evaluatedOperationsHash: batchHash(batch) },
        { baselineWorkflowUpdatedAt: notes.baselineWorkflowUpdatedAt }
      )
      if (!recorded) {
        passed = false
        problems.push(
          'The workflow was built or rebased while this evaluation ran. Evaluate again against the current graph.'
        )
      }
    } else await clearBuildNotesEvaluation(notes.id)
    return {
      workflowId: context.workflowId,
      notes: buildNotesPath(context.workflowId, 'notes'),
      passed,
      problems,
      placeholders: reading.placeholders,
      openItems: reading.blockingOpenItems,
      assumedItems: reading.assumedItems,
      dryRun,
    }
  },
})

/**
 * Applies the operations block that passed evaluation, atomically, so the agent never re-sends
 * the batch it already wrote. The apply's own build-notes check refuses notes edited since.
 */
export const applyBuildNotes = defineAuthorizedWorkflowUseCase({
  operation: buildNotesOperations.apply,
  resolveContext,
  authorizeResource,
  async execute({ principal, context }) {
    const notes = await requireNotes(context)
    const text = await readAdmittedNotes(principal, context, notes)
    const { batch, problems } = parseBatch(readBuildNotes(text))
    if (!batch) throw new OrchestrationError('validation', problems.join('; '))
    const result = await applyWorkflowOperations.execute({
      principal,
      input: {
        workflowId: context.workflowId,
        assertedWorkspaceId: context.workspaceId,
        ...batch,
        atomic: true,
      },
    })
    return {
      workflowId: context.workflowId,
      operationCount: result.operationCount,
      applied: result.applied,
      skipped: result.skipped,
      inputValidationErrors: result.inputValidationErrors,
      mintedBlockIds: result.mintedBlockIds,
      lint: hasWorkflowLintIssues(result.lint) ? summarizeWorkflowLintIssues(result.lint) : null,
      warnings: result.warnings,
      needsRedeployment: result.needsRedeployment,
    }
  },
})

/** What changed in the workflow since its baseline, ignoring layout-only moves, credentials redacted. */
export const getBuildNotesChanges = defineAuthorizedWorkflowUseCase({
  operation: buildNotesOperations.changes,
  resolveContext,
  authorizeResource,
  async execute({ principal, context }) {
    const notes = await requireNotes(context)
    if (!notes.baselineFileId) {
      throw new OrchestrationError(
        'conflict',
        'These build notes have no baseline yet. Run build-notes rebase to record the current graph.'
      )
    }
    const [baselineText, current] = await Promise.all([
      readBaselineText(context.workspaceId, notes.baselineFileId, (file) =>
        requireAdmittedWorkspaceFile(principal, context.workspaceId, file, 'complete')
      ),
      loadCurrentBaselineState(context.workflowId),
    ])
    const { hasChanges, diff, clearedFieldChanges } = diffFromBaseline(
      parseBaseline(baselineText),
      current
    )
    return {
      workflowId: context.workflowId,
      baseline: buildNotesPath(context.workflowId, 'baseline'),
      hasChanges,
      diff,
      /** Blocks whose credential or other withheld value changed; the values are never shown. */
      changedWithheldFields: clearedFieldChanges,
    }
  },
})

/**
 * Records the current graph as the notes' baseline, after the agent reconciled the notes with
 * edits made outside it. Recording it withdraws the evaluation: the notes describe a different
 * graph now. When a newer baseline was recorded meanwhile, that one stays, and so does any
 * evaluation made against it.
 */
export const rebaseBuildNotes = defineAuthorizedWorkflowUseCase({
  operation: buildNotesOperations.rebase,
  resolveContext,
  authorizeResource,
  async execute({ principal, context }) {
    const notes = await requireNotes(context)
    const recorded = await writeBaseline(
      notes,
      await loadCurrentBaselineState(context.workflowId),
      { userId: requirePrincipalSubjectUserId(principal), source: 'copilot' }
    )
    return {
      workflowId: context.workflowId,
      baseline: buildNotesPath(context.workflowId, 'baseline'),
      recordedAt: recorded.baselineWorkflowUpdatedAt?.toISOString() ?? null,
    }
  },
})

/**
 * Which of the given workflows have build notes, and whether each was saved after its baseline.
 * Empty while the feature is off, so a workspace without it never hears of notes.
 */
export const listBuildNotesStates = defineAuthorizedWorkspaceUseCase({
  operation: buildNotesOperations.list,
  resolveContext: ({ input }: { input: { workspaceId: string; workflowIds: readonly string[] } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:workspaces', isWithinScope: () => true } },
  async execute({ input, context }) {
    if (!(await isBuildNotesEnabled(context.workspaceOrganizationId))) return new Map()
    return readBuildNotesStates(context.workspaceId, input.workflowIds)
  },
})
