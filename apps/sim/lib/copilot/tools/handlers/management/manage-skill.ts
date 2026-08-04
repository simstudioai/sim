import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { copilotToolCanWrite, copilotWriteDeniedMessage } from '@/lib/copilot/tools/permissions'
import {
  performCreateSkill,
  performDeleteSkill,
  performUpdateSkill,
} from '@/lib/skills/orchestration'
import { listSkillsForUser } from '@/lib/workflows/skills/operations'

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
  // below (skill editor — explicit editor row or derived workspace admin).
  if (operation === 'add' && !copilotToolCanWrite(context.userPermission)) {
    return {
      success: false,
      error: copilotWriteDeniedMessage('manage_skill', operation, context.userPermission),
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

      const result = await performCreateSkill({
        workspaceId,
        userId: context.userId,
        name: params.name,
        description: params.description,
        content: params.content,
        source: 'tool_input',
      })
      if (!result.success || !result.skill) {
        return { success: false, error: result.error ?? 'Failed to create skill' }
      }

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: result.skill.id,
          name: result.skill.name,
          message: `Created skill "${result.skill.name}"`,
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

      // Partial update: omitted fields keep their current values server-side.
      const result = await performUpdateSkill({
        workspaceId,
        userId: context.userId,
        skillId: params.skillId,
        ...(params.name ? { name: params.name } : {}),
        ...(params.description ? { description: params.description } : {}),
        ...(params.content ? { content: params.content } : {}),
        source: 'tool_input',
      })
      if (!result.success || !result.skill) {
        return { success: false, error: result.error ?? 'Failed to update skill' }
      }

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: result.skill.id,
          name: result.skill.name,
          message: `Updated skill "${result.skill.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'delete'" }
      }

      const result = await performDeleteSkill({
        workspaceId,
        userId: context.userId,
        skillId: params.skillId,
        source: 'tool_input',
      })
      if (!result.success) {
        return { success: false, error: result.error ?? 'Failed to delete skill' }
      }

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
