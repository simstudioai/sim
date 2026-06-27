import { db } from '@sim/db'
import { type NextRequest, NextResponse } from 'next/server'
import { getForkDiffContract } from '@/lib/api/contracts/workspace-fork'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadSourceDeployedStates } from '@/lib/workspaces/fork/copy/deploy-bridge'
import { assertCanPromote } from '@/lib/workspaces/fork/lineage/authz'
import { loadForkBlockMap } from '@/lib/workspaces/fork/mapping/block-map-store'
import { collectForkDependentReconfigs } from '@/lib/workspaces/fork/mapping/dependent-reconfigs'
import { computeForkPromotePlan } from '@/lib/workspaces/fork/promote/promote-plan'
import { buildForkBlockIdResolver } from '@/lib/workspaces/fork/remap/block-identity'

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
      dependentReconfigs: collectForkDependentReconfigs(plan.items, sourceStates, resolveBlockId),
    })
  }
)
