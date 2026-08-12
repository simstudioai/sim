import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId, resolvePrincipalAttribution } from '@sim/auth/principal'
import type { skill } from '@sim/db/schema'
import type { ListSortOrder } from '@/lib/api/list-query'
import {
  authorizeWorkspaceOperation,
  defineAuthorizedWorkspaceUseCase,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { skillDelegationPolicy } from '@/lib/skills/application/authorization'
import { skillOperations } from '@/lib/skills/application/operations'
import {
  createSkill,
  deleteSkillRecord,
  type SkillUpsertItem,
  updateSkill,
  upsertSkillBatch,
} from '@/lib/skills/orchestration'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import {
  getSkillById,
  listSkillSummariesPage,
  listSkillsForUser,
  type SkillSortBy,
} from '@/lib/workflows/skills/operations'

type SkillRow = typeof skill.$inferSelect
type SkillWriteSource = 'api' | 'settings' | 'tool_input'

interface SkillWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

interface SkillContext extends SkillWorkspaceContext {
  skill: SkillRow
}

async function resolveWorkspaceContext(workspaceId: string): Promise<SkillWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveSkillContext(workspaceId: string, skillId: string): Promise<SkillContext> {
  const workspace = await resolveWorkspaceContext(workspaceId)
  const row = await getSkillById({ workspaceId: workspace.workspaceId, skillId })
  if (!row) throw new OrchestrationError('not_found', 'Skill not found')
  return { ...workspace, skill: row }
}

const authorizationOptions = { delegation: skillDelegationPolicy }

export interface ListSkillsInput {
  workspaceId: string
  search?: string
  sortBy: SkillSortBy
  sortOrder: ListSortOrder
  limit: number
  /** Position in the merged built-in + workspace list, read from the cursor. */
  offset: number
}

/**
 * The public skill list. Returns one page plus the window it was taken from,
 * because the surface presenter sees only this result and needs both to mint
 * the next cursor.
 */
export const listSkillsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.list,
  resolveContext: ({ input }: { input: ListSkillsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const page = await listSkillSummariesPage({
      workspaceId: context.workspaceId,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      offset: input.offset,
    })
    return {
      skills: page.skills,
      hasMore: page.hasMore,
      offset: page.offset,
      limit: page.limit,
    }
  },
})

export interface ListAvailableSkillsInput {
  workspaceId: string
}

export const listAvailableSkillsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.listAvailable,
  resolveContext: ({ input }: { input: ListAvailableSkillsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, context }) {
    const skills = await listSkillsForUser({
      workspaceId: context.workspaceId,
      userId: requirePrincipalSubjectUserId(principal),
    })
    return { skills }
  },
})

export interface GetSkillInput {
  workspaceId: string
  skillId: string
}

export const getSkillUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.read,
  resolveContext: ({ input }: { input: GetSkillInput }) =>
    resolveSkillContext(input.workspaceId, input.skillId),
  authorizationOptions,
  async execute({ context }) {
    return { skill: context.skill }
  },
})

export interface CreateSkillInput {
  workspaceId: string
  name: string
  description: string
  content: string
  source?: SkillWriteSource
}

export const createSkillUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.create,
  resolveContext: ({ input }: { input: CreateSkillInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const row = await createSkill({
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      name: input.name,
      description: input.description,
      content: input.content,
    })
    return { skill: row }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.SKILL_CREATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: result.skill.id,
    resourceName: result.skill.name,
    description: `Created skill "${result.skill.name}"`,
    metadata: { source: input.source },
  }),
})

export interface UpdateSkillInput {
  workspaceId: string
  skillId: string
  name?: string
  description?: string
  content?: string
  source?: SkillWriteSource
}

export const updateSkillUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.update,
  resolveContext: ({ input }: { input: UpdateSkillInput }) =>
    resolveSkillContext(input.workspaceId, input.skillId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const row = await updateSkill({
      workspaceId: context.workspaceId,
      userId: requirePrincipalSubjectUserId(principal),
      skillId: context.skill.id,
      name: input.name,
      description: input.description,
      content: input.content,
    })
    return { skill: row }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.SKILL_UPDATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: result.skill.id,
    resourceName: result.skill.name,
    description: `Updated skill "${result.skill.name}"`,
    metadata: { source: input.source },
  }),
})

export interface UpsertSkillsInput {
  workspaceId: string
  skills: SkillUpsertItem[]
  source?: SkillWriteSource
}

/**
 * Applies a mixed batch of skill creates and updates as one semantic
 * operation. Every item is authorized before any of them is written, and the
 * writes share one transaction, so a rejected item leaves the whole batch
 * unwritten and unaudited rather than partially committing it.
 *
 * The audit trail is unchanged in shape: one entry per skill actually written,
 * tagged `skill.created` or `skill.updated`. Only `metadata.operation` differs
 * from the single-item use cases, because the semantic operation genuinely is
 * the batch.
 */
export const upsertSkillsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.upsert,
  resolveContext: ({ input }: { input: UpsertSkillsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    /**
     * `skills.upsert` declares only the read floor an update needs. An item
     * without an id creates, which `skills.create` gates on workspace write —
     * so demand that too, still ahead of every write.
     */
    if (input.skills.some((item) => !item.id)) {
      await authorizeWorkspaceOperation(
        principal,
        skillOperations.create,
        context,
        authorizationOptions
      )
    }

    const touched = await upsertSkillBatch({
      workspaceId: context.workspaceId,
      userId: requirePrincipalSubjectUserId(principal),
      skills: input.skills,
    })
    return { touched }
  },
  projectAudit: ({ input, result }) =>
    result.touched.map((entry) => ({
      action: entry.operation === 'created' ? AuditAction.SKILL_CREATED : AuditAction.SKILL_UPDATED,
      resourceType: AuditResourceType.SKILL,
      resourceId: entry.id,
      resourceName: entry.name,
      description: `${entry.operation === 'created' ? 'Created' : 'Updated'} skill "${entry.name}"`,
      metadata: { source: input.source },
    })),
})

export interface DeleteSkillInput {
  workspaceId: string
  skillId: string
  source?: SkillWriteSource
}

export const deleteSkillUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.delete,
  resolveContext: ({ input }: { input: DeleteSkillInput }) =>
    resolveSkillContext(input.workspaceId, input.skillId),
  authorizationOptions,
  async execute({ principal, context }) {
    const row = await deleteSkillRecord({
      workspaceId: context.workspaceId,
      userId: requirePrincipalSubjectUserId(principal),
      skillId: context.skill.id,
    })
    return { skill: row }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.SKILL_DELETED,
    resourceType: AuditResourceType.SKILL,
    resourceId: result.skill.id,
    resourceName: result.skill.name,
    description: `Deleted skill "${result.skill.name}"`,
    metadata: { source: input.source },
  }),
})
