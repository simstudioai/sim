import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import type { skill } from '@sim/db/schema'
import type { ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { skillDelegationPolicy } from '@/lib/skills/application/authorization'
import { skillOperations } from '@/lib/skills/application/operations'
import { createSkill, deleteSkillRecord, updateSkill } from '@/lib/skills/orchestration'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import {
  getSkillById,
  listSkills,
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

function humanUserId(principal: Exclude<Principal, { kind: 'workspace_api_key' }>): string {
  return principal.kind === 'delegated' ? principal.subjectUserId : principal.userId
}

const authorizationOptions = { delegation: skillDelegationPolicy }

export interface ListSkillsInput {
  workspaceId: string
  search?: string
  sortBy: SkillSortBy
  sortOrder: ListSortOrder
}

export const listSkillsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.list,
  resolveContext: ({ input }: { input: ListSkillsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const skills = await listSkills({
      workspaceId: context.workspaceId,
      search: input.search,
      sort: { sortBy: input.sortBy, sortOrder: input.sortOrder },
    })
    return { skills }
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
      userId: humanUserId(principal),
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
      userId: humanUserId(principal),
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
      userId: humanUserId(principal),
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
