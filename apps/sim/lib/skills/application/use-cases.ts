import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId, resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { skill, skillMember } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import type { ListSortOrder } from '@/lib/api/list-query'
import {
  authorizeWorkspaceOperation,
  defineAuthorizedWorkspaceUseCase,
  ForbiddenOperationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSkillActorContext, listSkillEditors, type SkillEditor } from '@/lib/skills/access'
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
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import {
  getSkillById,
  listSkillSummariesPage,
  listSkillsForUser,
  type SkillSortBy,
} from '@/lib/workflows/skills/operations'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'

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

/**
 * Resolves the skill an editor MUTATION addresses.
 *
 * A built-in skill exists — `getSkillById` materializes it from code — so
 * reporting it as missing would contradict the read verbs. It has no editor
 * roster to change, which is the same refusal `resolveEditableSkill` gives for
 * update and delete.
 */
async function resolveSkillEditorContext(
  skillId: string,
  assertedWorkspaceId?: string
): Promise<SkillContext> {
  if (isBuiltinSkillId(skillId)) {
    throw new OrchestrationError(
      'validation',
      'Built-in skills are read-only and cannot be modified'
    )
  }

  const [row] = await db.select().from(skill).where(eq(skill.id, skillId)).limit(1)
  if (!row?.workspaceId || (assertedWorkspaceId && row.workspaceId !== assertedWorkspaceId)) {
    throw new OrchestrationError('not_found', 'Skill not found')
  }

  const workspace = await resolveWorkspaceContext(row.workspaceId)
  return { ...workspace, skill: row }
}

/**
 * Resolves the skill an editor LIST addresses.
 *
 * Listing is a read, so a built-in id is not a malformed request: the skill is
 * real and `skills get` returns it. It resolves through the workspace the
 * caller asserted, and the roster it reports is empty.
 */
async function resolveSkillEditorListContext(input: ListSkillEditorsInput): Promise<SkillContext> {
  if (isBuiltinSkillId(input.skillId) && input.workspaceId) {
    return resolveSkillContext(input.workspaceId, input.skillId)
  }
  return resolveSkillEditorContext(input.skillId, input.workspaceId)
}

const authorizationOptions = { delegation: skillDelegationPolicy }

async function requireSkillEditorAccess(userId: string, context: SkillContext): Promise<void> {
  const actor = await getSkillActorContext(context.skill.id, userId)
  if (
    !actor.skill ||
    actor.skill.workspaceId !== context.workspaceId ||
    !actor.hasWorkspaceAccess
  ) {
    throw new OrchestrationError('not_found', 'Skill not found')
  }
  if (!actor.canEdit) {
    throw new ForbiddenOperationError(
      'SKILL_EDITOR_ACCESS_REQUIRED',
      'Skill editor access required'
    )
  }
}

export type SkillEditorTarget =
  | { kind: 'user_id'; userId: string }
  | { kind: 'email'; email: string }

async function resolveSkillEditorTarget(
  context: SkillContext,
  target: SkillEditorTarget
): Promise<SkillEditor> {
  const editors = await listSkillEditors({
    id: context.skill.id,
    workspaceId: context.workspaceId,
  })
  const workspaceMembers = await getUsersWithPermissions(context.workspaceId)
  const member =
    target.kind === 'user_id'
      ? workspaceMembers.find(({ userId }) => userId === target.userId)
      : workspaceMembers.find(
          ({ email }) => email.toLowerCase() === target.email.trim().toLowerCase()
        )
  if (!member) {
    throw new OrchestrationError('validation', 'User is not a member of this workspace')
  }
  if (member.permissionType === 'admin') {
    throw new OrchestrationError('validation', 'Workspace admins can always edit skills')
  }
  const existing = editors.find(({ userId }) => userId === member.userId)
  return (
    existing ?? {
      id: '',
      userId: member.userId,
      userName: member.name,
      userEmail: member.email,
      userImage: member.image,
      isWorkspaceAdmin: false,
    }
  )
}

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

export interface ListSkillEditorsInput {
  workspaceId?: string
  skillId: string
  sortBy: 'email' | 'name'
  sortOrder: ListSortOrder
  limit?: number
  offset?: number
}

export const listSkillEditorsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.listEditors,
  resolveContext: ({ input }: { input: ListSkillEditorsInput }) =>
    resolveSkillEditorListContext(input),
  authorizationOptions,
  async execute({ input, context }) {
    if (isBuiltinSkillId(input.skillId)) {
      return { editors: [], hasMore: false, offset: input.offset ?? 0, limit: input.limit ?? 0 }
    }
    const editors = await listSkillEditors({
      id: context.skill.id,
      workspaceId: context.workspaceId,
    })
    const direction = input.sortOrder === 'asc' ? 1 : -1
    const sorted = editors.sort((left, right) => {
      const leftValue = input.sortBy === 'email' ? (left.userEmail ?? '') : (left.userName ?? '')
      const rightValue = input.sortBy === 'email' ? (right.userEmail ?? '') : (right.userName ?? '')
      const primary = leftValue.localeCompare(rightValue)
      return primary === 0
        ? left.userId.localeCompare(right.userId) * direction
        : primary * direction
    })
    if (input.limit === undefined) {
      return { editors: sorted, hasMore: false, offset: 0, limit: sorted.length }
    }
    const offset = input.offset ?? 0
    return {
      editors: sorted.slice(offset, offset + input.limit),
      hasMore: sorted.length > offset + input.limit,
      offset,
      limit: input.limit,
    }
  },
})

export interface GrantSkillEditorInput {
  workspaceId?: string
  skillId: string
  target: SkillEditorTarget
}

export const grantSkillEditorUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.grantEditor,
  resolveContext: ({ input }: { input: GrantSkillEditorInput }) =>
    resolveSkillEditorContext(input.skillId, input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ principal, context }) =>
    requireSkillEditorAccess(requirePrincipalSubjectUserId(principal), context),
  async execute({ principal, input, context }) {
    const target = await resolveSkillEditorTarget(context, input.target)
    if (target.id) return { editor: target, created: false, workspaceId: context.workspaceId }

    const now = new Date()
    const [inserted] = await db
      .insert(skillMember)
      .values({
        id: generateId(),
        skillId: context.skill.id,
        userId: target.userId,
        invitedBy: requirePrincipalSubjectUserId(principal),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [skillMember.skillId, skillMember.userId] })
      .returning({ id: skillMember.id })

    if (inserted) {
      return {
        editor: { ...target, id: inserted.id },
        created: true,
        workspaceId: context.workspaceId,
      }
    }

    const [concurrent] = await db
      .select({ id: skillMember.id })
      .from(skillMember)
      .where(and(eq(skillMember.skillId, context.skill.id), eq(skillMember.userId, target.userId)))
      .limit(1)
    if (!concurrent) throw new Error('Skill editor insert conflicted without an existing row')
    return {
      editor: { ...target, id: concurrent.id },
      created: false,
      workspaceId: context.workspaceId,
    }
  },
  projectAudit: ({ result, context }) =>
    result.created
      ? {
          action: AuditAction.SKILL_MEMBER_ADDED,
          resourceType: AuditResourceType.SKILL,
          resourceId: context.skill.id,
          resourceName: context.skill.name,
          description: 'Added skill editor',
          metadata: { targetUserId: result.editor.userId },
        }
      : [],
})

export interface RevokeSkillEditorInput {
  workspaceId?: string
  skillId: string
  target: SkillEditorTarget
}

export const revokeSkillEditorUseCase = defineAuthorizedWorkspaceUseCase({
  operation: skillOperations.revokeEditor,
  resolveContext: ({ input }: { input: RevokeSkillEditorInput }) =>
    resolveSkillEditorContext(input.skillId, input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ principal, context }) =>
    requireSkillEditorAccess(requirePrincipalSubjectUserId(principal), context),
  async execute({ input, context }) {
    const target = await resolveSkillEditorTarget(context, input.target)
    const [removed] = await db
      .delete(skillMember)
      .where(and(eq(skillMember.skillId, context.skill.id), eq(skillMember.userId, target.userId)))
      .returning({ id: skillMember.id })
    if (!removed) throw new OrchestrationError('not_found', 'Editor not found')
    return { editor: target, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result, context }) => ({
    action: AuditAction.SKILL_MEMBER_REMOVED,
    resourceType: AuditResourceType.SKILL,
    resourceId: context.skill.id,
    resourceName: context.skill.name,
    description: 'Removed skill editor',
    metadata: { targetUserId: result.editor.userId },
  }),
})
