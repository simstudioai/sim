import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { deleteSkill, listSkills, upsertSkills } from '@/lib/workflows/skills/operations'

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

  const writeOps: string[] = ['add', 'edit', 'delete']
  if (
    writeOps.includes(operation) &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: '${operation}' on manage_skill requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const skills = await listSkills({ workspaceId })

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

      const resultSkills = await upsertSkills({
        skills: [{ name: params.name, description: params.description, content: params.content }],
        workspaceId,
        userId: context.userId,
      })
      const created = resultSkills.find((s) => s.name === params.name)

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

      const existing = await listSkills({ workspaceId })
      const found = existing.find((s) => s.id === params.skillId)
      if (!found) {
        return { success: false, error: `Skill not found: ${params.skillId}` }
      }

      await upsertSkills({
        skills: [
          {
            id: params.skillId,
            name: params.name || found.name,
            description: params.description || found.description,
            content: params.content || found.content,
          },
        ],
        workspaceId,
        userId: context.userId,
      })

      return {
        success: true,
        output: {
          success: true,
          operation,
          skillId: params.skillId,
          name: params.name || found.name,
          message: `Updated skill "${params.name || found.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.skillId) {
        return { success: false, error: "'skillId' is required for 'delete'" }
      }

      const deleted = await deleteSkill({ skillId: params.skillId, workspaceId })
      if (!deleted) {
        return { success: false, error: `Skill not found: ${params.skillId}` }
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
      error: error instanceof Error ? error.message : 'Failed to manage skill',
    }
  }
}
