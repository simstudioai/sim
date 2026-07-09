import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getForkDiffContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadTargetDraftSubBlocks } from '@/ee/workspace-forking/lib/copy/copy-workflows'
import { loadSourceDeployedStates } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import { assertCanPromote } from '@/ee/workspace-forking/lib/lineage/authz'
import { loadForkBlockMap } from '@/ee/workspace-forking/lib/mapping/block-map-store'
import {
  collectForkDependentReconfigs,
  collectForkResourceUsages,
} from '@/ee/workspace-forking/lib/mapping/dependent-reconfigs'
import {
  forkDependentValueKey,
  loadForkDependentValues,
} from '@/ee/workspace-forking/lib/mapping/dependent-value-store'
import { listForkResourceCandidates } from '@/ee/workspace-forking/lib/mapping/resources'
import {
  annotateForkClearedRefSourceLiveness,
  collectForkClearedRefCandidates,
} from '@/ee/workspace-forking/lib/promote/cleared-refs'
import { computeForkPromotePlan } from '@/ee/workspace-forking/lib/promote/promote-plan'
import { buildForkBlockIdResolver } from '@/ee/workspace-forking/lib/remap/block-identity'
import { readTargetDraftDependentValue } from '@/ee/workspace-forking/lib/remap/remap-references'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getForkDiffContract, req, context)
    if (!parsed.success) return parsed.response
    const { id } = parsed.data.params
    const { otherWorkspaceId, direction } = parsed.data.query

    const auth = await assertCanPromote(id, otherWorkspaceId, direction, session.user.id)

    const { deployedWorkflows, sourceStates } = await loadSourceDeployedStates(
      auth.sourceWorkspaceId
    )
    const plan = await computeForkPromotePlan({
      executor: db,
      edge: auth.edge,
      sourceWorkspaceId: auth.sourceWorkspaceId,
      targetWorkspaceId: auth.targetWorkspaceId,
      direction,
      deployedSourceWorkflows: deployedWorkflows,
      sourceStates,
    })

    // Resolve dependent-reconfig target block ids through the SAME persisted block map the
    // sync will use, so a re-pick the modal keys by target block id lands on the block the
    // promote actually writes (on push that's the parent's original id, not a derived one).
    const sourceIsParent = auth.sourceWorkspaceId === auth.edge.parentWorkspaceId
    const blockMap = await loadForkBlockMap(db, auth.edge.childWorkspaceId)
    const resolveBlockId = buildForkBlockIdResolver(sourceIsParent, blockMap)

    // Stored dependent values are the source of truth for what each selector is set to. Overlay
    // them as each field's currentValue so the modal pre-fills what the user actually saved.
    // Before the FIRST sync populates the store (fork-create seeds mappings but no dependent
    // values), the fallback is the TARGET's own configured value (loaded from its draft) - never
    // the source's, which would overwrite the target's selection. The stored read spans EVERY
    // plan target: a create-mode (never-synced) workflow's deterministic target id is what the
    // first sync will use, so values pre-configured for it in the mapping editor pre-fill here
    // too. The draft read stays replace-scoped (creates have no target draft to fall back to).
    const replaceTargetIds = plan.items
      .filter((item) => item.mode === 'replace')
      .map((item) => item.targetWorkflowId)
    const allTargetIds = plan.items.map((item) => item.targetWorkflowId)
    const [storedValues, targetDraftByWorkflow, sourceCandidates, sourceWorkflowRows] =
      await Promise.all([
        loadForkDependentValues(db, auth.edge.childWorkspaceId, allTargetIds),
        loadTargetDraftSubBlocks(db, replaceTargetIds),
        // Source resource labels (per kind) + workflow names, for the cleared-ref list's display.
        listForkResourceCandidates(db, auth.sourceWorkspaceId),
        db
          .select({ id: workflow.id, name: workflow.name })
          .from(workflow)
          .where(eq(workflow.workspaceId, auth.sourceWorkspaceId)),
      ])
    const storedByKey = new Map(
      storedValues.map((entry) => [
        forkDependentValueKey(entry.targetWorkflowId, entry.targetBlockId, entry.subBlockKey),
        entry.value,
      ])
    )

    // Source block subBlocks keyed by their resolved target identity, so the first-sync draft
    // fallback can identity-check a nested tool against the SOURCE dependent tool it came from -
    // an index alone may point at a different tool in the target draft, whose value isn't the
    // dependent's. Read structurally (only each subblock's `value`), so the in-memory state's
    // blocks pass without a cast.
    const sourceBlocksByTarget = new Map<string, Map<string, Record<string, { value?: unknown }>>>()
    for (const item of plan.items) {
      if (item.mode !== 'replace') continue
      const state = sourceStates.get(item.sourceWorkflowId)
      if (!state) continue
      const byBlock = new Map<string, Record<string, { value?: unknown }>>()
      for (const [sourceBlockId, block] of Object.entries(state.blocks)) {
        byBlock.set(resolveBlockId(item.targetWorkflowId, sourceBlockId), block.subBlocks ?? {})
      }
      sourceBlocksByTarget.set(item.targetWorkflowId, byBlock)
    }

    // Replace-target fields pre-fill from the store, falling back to the TARGET's own draft
    // value before the first sync populates the store (never the source's, which would
    // overwrite the target's selection). Create-target fields (never-synced workflows)
    // pre-fill from the store, falling back to the SOURCE value the collector emitted -
    // that's exactly what the first sync copies verbatim, so the pre-fill is honest and
    // configuring it ahead of the first sync is possible (the deterministic target ids
    // already exist).
    const dependentReconfigs = [
      ...collectForkDependentReconfigs(plan.items, sourceStates, resolveBlockId).map((field) => ({
        ...field,
        currentValue:
          storedByKey.get(
            forkDependentValueKey(field.targetWorkflowId, field.targetBlockId, field.subBlockKey)
          ) ??
          readTargetDraftDependentValue(
            targetDraftByWorkflow.get(field.targetWorkflowId)?.get(field.targetBlockId),
            sourceBlocksByTarget.get(field.targetWorkflowId)?.get(field.targetBlockId),
            field.subBlockKey
          ),
      })),
      ...collectForkDependentReconfigs(plan.items, sourceStates, resolveBlockId, 'create').map(
        (field) => ({
          ...field,
          currentValue:
            storedByKey.get(
              forkDependentValueKey(field.targetWorkflowId, field.targetBlockId, field.subBlockKey)
            ) ?? field.currentValue,
        })
      ),
    ]

    // References this sync will blank in the target (per block/field), for the pre-sync cleared-ref
    // list. Labels resolve from the source candidate lists + workflow names loaded above.
    const sourceLabels = new Map<string, string>()
    for (const [kind, candidates] of Object.entries(sourceCandidates)) {
      for (const candidate of candidates)
        sourceLabels.set(`${kind}:${candidate.id}`, candidate.label)
    }
    const sourceWorkflowNames = new Map(sourceWorkflowRows.map((row) => [row.id, row.name]))
    // Annotate each reference-cause entry's source liveness so the client can phrase the blocker
    // reason (a deleted source can't be copied - it must be mapped to a live target resource).
    const clearedRefs = await annotateForkClearedRefSourceLiveness(
      db,
      auth.sourceWorkspaceId,
      collectForkClearedRefCandidates({
        items: plan.items,
        sourceStates,
        resolver: plan.resolver,
        workflowIdMap: plan.workflowIdMap,
        resolveBlockId,
        sourceLabels,
        sourceWorkflowNames,
      })
    )

    const toRef = (reference: (typeof plan.unmappedRequired)[number]) => ({
      kind: reference.kind,
      sourceId: reference.sourceId,
      required: reference.required,
      blockName: reference.blockName,
    })

    // Orient the mapping around the workspace the modal is open in (`id`): show the
    // caller's workflow name first, the sync partner's second, so renames are legible.
    const currentIsSource = auth.sourceWorkspaceId === id
    const workflows = [
      ...plan.items.map((item) => {
        if (item.mode === 'create') {
          // The target inherits the source's name, so both sides read the same.
          return {
            action: 'create' as const,
            currentName: item.sourceMeta.name,
            otherName: item.sourceMeta.name,
          }
        }
        const targetName = item.targetName ?? item.sourceMeta.name
        return {
          action: 'update' as const,
          currentName: currentIsSource ? item.sourceMeta.name : targetName,
          otherName: currentIsSource ? targetName : item.sourceMeta.name,
        }
      }),
      ...plan.archivedTargets.map((target) => ({
        action: 'archive' as const,
        currentName: target.name,
        otherName: target.name,
      })),
    ]

    return NextResponse.json({
      sourceWorkspaceId: auth.sourceWorkspaceId,
      targetWorkspaceId: auth.targetWorkspaceId,
      willUpdate: plan.willUpdate,
      willCreate: plan.willCreate,
      willArchive: plan.willArchive,
      workflows,
      unmappedRequired: plan.unmappedRequired.map(toRef),
      unmappedOptional: plan.unmappedOptional.map(toRef),
      mcpReauthServerIds: plan.mcpReauthServerIds,
      inlineSecretSources: plan.inlineSecretSources,
      dependentReconfigs,
      resourceUsages: collectForkResourceUsages(plan.items, sourceStates),
      copyableUnmapped: plan.copyableUnmapped,
      clearedRefs,
    })
  }
)
