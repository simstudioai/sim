import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeCopilotSkillUseCase } from '@/lib/copilot/application/execute-skill-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createSkillUseCase,
  deleteSkillUseCase,
  listAvailableSkillsUseCase,
  updateSkillUseCase,
} from '@/lib/skills/application/use-cases'

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

  try {
    if (operation === 'list') {
      const { skills } = await executeCopilotSkillUseCase(context, listAvailableSkillsUseCase, {
        workspaceId,
      })

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

      const { skill } = await executeCopilotSkillUseCase(context, createSkillUseCase, {
        workspaceId,
        name: params.name,
        description: params.description,
        content: params.content,
        source: 'tool_input',
      })
      captureServerEvent(
        context.userId,
        'skill_created',
        {
          skill_id: skill.id,
          skill_name: skill.name,
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
          skillId: skill.id,
          name: skill.name,
          message: `Created skill "${skill.name}"`,
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

      const { skill } = await executeCopilotSkillUseCase(context, updateSkillUseCase, {
        workspaceId,
        skillId: params.skillId,
        ...(params.name ? { name: params.name } : {}),
        ...(params.description ? { description: params.description } : {}),
        ...(params.content ? { content: params.content } : {}),
        source: 'tool_input',
      })
      captureServerEvent(
        context.userId,
        'skill_updated',
        {
          skill_id: skill.id,
          skill_name: skill.name,
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
          skillId: skill.id,
          name: skill.name,
          message: `Updated skill "${skill.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'delete'" }
      }

      const { skill } = await executeCopilotSkillUseCase(context, deleteSkillUseCase, {
        workspaceId,
        skillId: params.skillId,
        source: 'tool_input',
      })
      captureServerEvent(
        context.userId,
        'skill_deleted',
        { skill_id: skill.id, workspace_id: workspaceId, source: 'tool_input' },
        { groups: { workspace: workspaceId } }
      )

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: skill.id,
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
    const classified = asOrchestrationError(error)
    return {
      success: false,
      error:
        classified && classified.code !== 'internal'
          ? classified.message
          : 'Failed to manage skill',
    }
  }
}
