import { db } from '@sim/db'
import { type NextRequest, NextResponse } from 'next/server'
import { getForkDiffContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  coerceObjectArray,
  isRecord,
  type SubBlockRecord,
} from '@/lib/workflows/persistence/remap-internal-ids'
import { loadTargetDraftSubBlocks } from '@/lib/workspaces/fork/copy/copy-workflows'
import { loadSourceDeployedStates } from '@/lib/workspaces/fork/copy/deploy-bridge'
import { assertCanPromote } from '@/lib/workspaces/fork/lineage/authz'
import { loadForkBlockMap } from '@/lib/workspaces/fork/mapping/block-map-store'
import {
  collectForkDependentReconfigs,
  collectForkResourceUsages,
} from '@/lib/workspaces/fork/mapping/dependent-reconfigs'
import {
  forkDependentValueKey,
  loadForkDependentValues,
} from '@/lib/workspaces/fork/mapping/dependent-value-store'
import { computeForkPromotePlan } from '@/lib/workspaces/fork/promote/promote-plan'
import { buildForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'

/** A nested dependent key `toolInput[index].paramId` (matches the override/needs-config format). */
const NESTED_DEPENDENT_KEY = /^([^[]+)\[(\d+)\]\.(.+)$/

/**
 * Read a dependent field's currently-configured value from a target block's draft subBlocks,
 * handling the nested `toolInput[index].paramId` shape used for tool-input dependents. Seeds the
 * diff pre-fill from the TARGET (never the source, which would overwrite the target's own
 * selection on an edge that predates the stored mapping). Returns '' when unset.
 */
function readTargetDraftDependentValue(
  blockSubBlocks: SubBlockRecord | undefined,
  subBlockKey: string
): string {
  if (!blockSubBlocks) return ''
  const nested = NESTED_DEPENDENT_KEY.exec(subBlockKey)
  if (nested) {
    const [, toolInputId, indexStr, paramId] = nested
    const { array } = coerceObjectArray(blockSubBlocks[toolInputId]?.value)
    const tool = array?.[Number(indexStr)]
    if (!isRecord(tool)) return ''
    const params = isRecord(tool.params) ? tool.params : {}
    const value = params[paramId]
    return typeof value === 'string' ? value : ''
  }
  const value = blockSubBlocks[subBlockKey]?.value
  return typeof value === 'string' ? value : ''
}

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
    // them as each field's currentValue so the modal pre-fills what the user actually saved. For
    // an edge that predates the store the fallback is the TARGET's own configured value (loaded
    // from its draft) - never the source's, which would overwrite the target's selection on the
    // first sync. Both the stored read and the draft read are scoped to the plan's replace
    // targets, the only workflows with dependents to reconfigure.
    const replaceTargetIds = plan.items
      .filter((item) => item.mode === 'replace')
      .map((item) => item.targetWorkflowId)
    const [storedValues, targetDraftByWorkflow] = await Promise.all([
      loadForkDependentValues(db, auth.edge.childWorkspaceId, replaceTargetIds),
      loadTargetDraftSubBlocks(db, replaceTargetIds),
    ])
    const storedByKey = new Map(
      storedValues.map((entry) => [
        forkDependentValueKey(entry.targetWorkflowId, entry.targetBlockId, entry.subBlockKey),
        entry.value,
      ])
    )
    const dependentReconfigs = collectForkDependentReconfigs(
      plan.items,
      sourceStates,
      resolveBlockId
    ).map((field) => ({
      ...field,
      currentValue:
        storedByKey.get(
          forkDependentValueKey(field.targetWorkflowId, field.targetBlockId, field.subBlockKey)
        ) ??
        readTargetDraftDependentValue(
          targetDraftByWorkflow.get(field.targetWorkflowId)?.get(field.targetBlockId),
          field.subBlockKey
        ),
    }))

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
    })
  }
)
