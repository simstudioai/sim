import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { captureServerEvent } from '@/lib/posthog/server'
import { getSkillActorContext } from '@/lib/skills/access'
import { isBuiltinSkillId } from '@/lib/workflows/skills/builtin-skills'
import { deleteSkill, listSkillsForUser, upsertSkills } from '@/lib/workflows/skills/operations'

const logger = createLogger('CopilotToolExecutor')

type ManageSkillOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageSkillParams {
  operation?: string
  skillId?: string
  name?: string
  description?: string
  content?: string
}

export async function executeManageSkill(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageSkillParams
  const operation = String(params.operation || '').toLowerCase() as ManageSkillOperation
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  if (!workspaceId) {
    return { success: false, error: 'workspaceId is required' }
  }

  // Workspace write gates only creation; edits and deletes are gated per skill
  // below (skill admin — explicit member admin or derived workspace admin).
  if (
    operation === 'add' &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: 'add' on manage_skill requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const skills = await listSkillsForUser({ workspaceId, userId: context.userId })

      return {
        success: true,
        output: {
          success: true,
          operation,
          skills: skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            createdAt: s.createdAt,
          })),
          count: skills.length,
        },
      }
    }

    if (operation === 'add') {
      if (!params.name || !params.description || !params.content) {
        return {
          success: false,
          error: "'name', 'description', and 'content' are required for 'add'",
        }
      }

      const { skills: resultSkills } = await upsertSkills({
        skills: [{ name: params.name, description: params.description, content: params.content }],
        workspaceId,
        userId: context.userId,
      })
      const created = resultSkills.find((s) => s.name === params.name)

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.SKILL_CREATED,
        resourceType: AuditResourceType.SKILL,
        resourceId: created?.id,
        resourceName: params.name,
        description: `Created skill "${params.name}"`,
        metadata: { source: 'tool_input' },
      })
      if (created?.id) {
        captureServerEvent(
          context.userId,
          'skill_created',
          {
            skill_id: created.id,
            skill_name: params.name,
            workspace_id: workspaceId,
            source: 'tool_input',
          },
          { groups: { workspace: workspaceId } }
        )
      }

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: created?.id,
          name: params.name,
          message: `Created skill "${params.name}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'edit'" }
      }
      if (!params.name && !params.description && !params.content) {
        return {
          success: false,
          error: "At least one of 'name', 'description', or 'content' is required for 'edit'",
        }
      }

      if (isBuiltinSkillId(params.skillId)) {
        return { success: false, error: 'Built-in skills are read-only and cannot be modified' }
      }

      const actor = await getSkillActorContext(params.skillId, context.userId)
      if (!actor.skill || actor.skill.workspaceId !== workspaceId || actor.role === null) {
        return { success: false, error: `Skill not found: ${params.skillId}` }
      }
      if (actor.role !== 'admin') {
        return {
          success: false,
          error: `Permission denied: editing skill "${actor.skill.name}" requires skill admin access. Ask a skill admin to add you as an admin.`,
        }
      }

      // Partial update: omitted fields keep their current values server-side.
      await upsertSkills({
        skills: [
          {
            id: params.skillId,
            ...(params.name ? { name: params.name } : {}),
            ...(params.description ? { description: params.description } : {}),
            ...(params.content ? { content: params.content } : {}),
          },
        ],
        workspaceId,
        userId: context.userId,
      })

      const updatedName = params.name || actor.skill.name
      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.SKILL_UPDATED,
        resourceType: AuditResourceType.SKILL,
        resourceId: params.skillId,
        resourceName: updatedName,
        description: `Updated skill "${updatedName}"`,
        metadata: { source: 'tool_input' },
      })
      captureServerEvent(
        context.userId,
        'skill_updated',
        {
          skill_id: params.skillId,
          skill_name: updatedName,
          workspace_id: workspaceId,
          source: 'tool_input',
        },
        { groups: { workspace: workspaceId } }
      )

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: params.skillId,
          name: updatedName,
          message: `Updated skill "${updatedName}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'delete'" }
      }

      if (!isBuiltinSkillId(params.skillId)) {
        const actor = await getSkillActorContext(params.skillId, context.userId)
        if (!actor.skill || actor.skill.workspaceId !== workspaceId || actor.role === null) {
          return { success: false, error: `Skill not found: ${params.skillId}` }
        }
        if (actor.role !== 'admin') {
          return {
            success: false,
            error: `Permission denied: deleting skill "${actor.skill.name}" requires skill admin access. Ask a skill admin to add you as an admin.`,
          }
        }
      }

      const deleted = await deleteSkill({ skillId: params.skillId, workspaceId })
      if (!deleted) {
        return { success: false, error: `Skill not found: ${params.skillId}` }
      }

      recordAudit({
        workspaceId,
        actorId: context.userId,
        action: AuditAction.SKILL_DELETED,
        resourceType: AuditResourceType.SKILL,
        resourceId: params.skillId,
        description: 'Deleted skill',
        metadata: { source: 'tool_input' },
      })
      captureServerEvent(
        context.userId,
        'skill_deleted',
        { skill_id: params.skillId, workspace_id: workspaceId, source: 'tool_input' },
        { groups: { workspace: workspaceId } }
      )

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: params.skillId,
          message: 'Deleted skill',
        },
      }
    }

    return { success: false, error: `Unsupported operation for manage_skill: ${operation}` }
  } catch (error) {
    logger.error(
      context.messageId
        ? `manage_skill execution failed [messageId:${context.messageId}]`
        : 'manage_skill execution failed',
      {
        operation,
        workspaceId,
        error: toError(error).message,
      }
    )
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to manage skill'),
    }
  }
}
