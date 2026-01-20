import { createLogger } from '@sim/logger'
import crypto from 'crypto'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { getBlockConfigServerTool } from '@/lib/copilot/tools/server/blocks/get-block-config'
import { getBlockOptionsServerTool } from '@/lib/copilot/tools/server/blocks/get-block-options'
import { getBlocksAndToolsServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-and-tools'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import {
  KnowledgeBaseInput,
  knowledgeBaseServerTool,
} from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getWorkflowConsoleServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-console'
import {
  ExecuteResponseSuccessSchema,
  GetBlockConfigInput,
  GetBlockConfigResult,
  GetBlockOptionsInput,
  GetBlockOptionsResult,
  GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  GetTriggerBlocksInput,
  GetTriggerBlocksResult,
} from '@/lib/copilot/tools/shared/schemas'

/** Lock expiry in seconds for edit_workflow operations */
const EDIT_WORKFLOW_LOCK_EXPIRY = 30

/** Maximum wait time in ms before giving up on acquiring the lock */
const EDIT_WORKFLOW_LOCK_TIMEOUT = 15000

/** Delay between lock acquisition retries in ms */
const EDIT_WORKFLOW_LOCK_RETRY_DELAY = 100

// Generic execute response schemas (success path only for this route; errors handled via HTTP status)
export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

// Define server tool registry for the new copilot runtime
const serverToolRegistry: Record<string, BaseServerTool<any, any>> = {}
const logger = createLogger('ServerToolRouter')

// Register tools
serverToolRegistry[getBlocksAndToolsServerTool.name] = getBlocksAndToolsServerTool
serverToolRegistry[getBlocksMetadataServerTool.name] = getBlocksMetadataServerTool
serverToolRegistry[getBlockOptionsServerTool.name] = getBlockOptionsServerTool
serverToolRegistry[getBlockConfigServerTool.name] = getBlockConfigServerTool
serverToolRegistry[getTriggerBlocksServerTool.name] = getTriggerBlocksServerTool
serverToolRegistry[editWorkflowServerTool.name] = editWorkflowServerTool
serverToolRegistry[getWorkflowConsoleServerTool.name] = getWorkflowConsoleServerTool
serverToolRegistry[searchDocumentationServerTool.name] = searchDocumentationServerTool
serverToolRegistry[searchOnlineServerTool.name] = searchOnlineServerTool
serverToolRegistry[setEnvironmentVariablesServerTool.name] = setEnvironmentVariablesServerTool
serverToolRegistry[getCredentialsServerTool.name] = getCredentialsServerTool
serverToolRegistry[makeApiRequestServerTool.name] = makeApiRequestServerTool
serverToolRegistry[knowledgeBaseServerTool.name] = knowledgeBaseServerTool

/**
 * Acquire a lock with retries for workflow-mutating operations
 */
async function acquireLockWithRetry(
  lockKey: string,
  lockValue: string,
  expirySeconds: number,
  timeoutMs: number,
  retryDelayMs: number
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const acquired = await acquireLock(lockKey, lockValue, expirySeconds)
    if (acquired) {
      return true
    }
    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }

  return false
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: { userId: string }
): Promise<any> {
  const tool = serverToolRegistry[toolName]
  if (!tool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }
  logger.debug('Routing to tool', {
    toolName,
    payloadPreview: (() => {
      try {
        return JSON.stringify(payload).slice(0, 200)
      } catch {
        return undefined
      }
    })(),
  })

  let args: any = payload || {}
  if (toolName === 'get_blocks_and_tools') {
    args = GetBlocksAndToolsInput.parse(args)
  }
  if (toolName === 'get_blocks_metadata') {
    args = GetBlocksMetadataInput.parse(args)
  }
  if (toolName === 'get_block_options') {
    args = GetBlockOptionsInput.parse(args)
  }
  if (toolName === 'get_block_config') {
    args = GetBlockConfigInput.parse(args)
  }
  if (toolName === 'get_trigger_blocks') {
    args = GetTriggerBlocksInput.parse(args)
  }
  if (toolName === 'knowledge_base') {
    args = KnowledgeBaseInput.parse(args)
  }

  // For edit_workflow, acquire a per-workflow lock to prevent race conditions
  // when multiple edit_workflow calls happen in parallel for the same workflow
  let lockKey: string | null = null
  let lockValue: string | null = null

  if (toolName === 'edit_workflow' && args.workflowId) {
    lockKey = `copilot:edit_workflow:lock:${args.workflowId}`
    lockValue = crypto.randomUUID()

    const acquired = await acquireLockWithRetry(
      lockKey,
      lockValue,
      EDIT_WORKFLOW_LOCK_EXPIRY,
      EDIT_WORKFLOW_LOCK_TIMEOUT,
      EDIT_WORKFLOW_LOCK_RETRY_DELAY
    )

    if (!acquired) {
      logger.warn('Failed to acquire edit_workflow lock after timeout', {
        workflowId: args.workflowId,
        timeoutMs: EDIT_WORKFLOW_LOCK_TIMEOUT,
      })
      throw new Error(
        'Workflow is currently being edited by another operation. Please try again shortly.'
      )
    }

    logger.debug('Acquired edit_workflow lock', {
      workflowId: args.workflowId,
      lockKey,
    })
  }

  try {
    const result = await tool.execute(args, context)

    if (toolName === 'get_blocks_and_tools') {
      return GetBlocksAndToolsResult.parse(result)
    }
    if (toolName === 'get_blocks_metadata') {
      return GetBlocksMetadataResult.parse(result)
    }
    if (toolName === 'get_block_options') {
      return GetBlockOptionsResult.parse(result)
    }
    if (toolName === 'get_block_config') {
      return GetBlockConfigResult.parse(result)
    }
    if (toolName === 'get_trigger_blocks') {
      return GetTriggerBlocksResult.parse(result)
    }

    return result
  } finally {
    // Always release the lock if we acquired one
    if (lockKey && lockValue) {
      const released = await releaseLock(lockKey, lockValue)
      if (released) {
        logger.debug('Released edit_workflow lock', {
          workflowId: args.workflowId,
          lockKey,
        })
      } else {
        logger.warn('Failed to release edit_workflow lock (may have expired)', {
          workflowId: args.workflowId,
          lockKey,
        })
      }
    }
  }
}
