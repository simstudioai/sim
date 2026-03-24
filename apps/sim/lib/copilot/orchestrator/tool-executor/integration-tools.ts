import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type {
  ExecutionContext,
  ToolCallResult,
  ToolCallState,
} from '@/lib/copilot/orchestrator/types'
import { isHosted } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { getAccessibleOAuthCredentials } from '@/lib/credentials/environment'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getTableById, queryRows } from '@/lib/table/service'
import {
  downloadWorkspaceFile,
  findWorkspaceFileRecord,
  getSandboxWorkspaceFilePath,
  listWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getWorkflowById } from '@/lib/workflows/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { executeTool } from '@/tools'
import type { ToolConfig } from '@/tools/types'
import { resolveToolId } from '@/tools/utils'

const logger = createLogger('CopilotIntegrationTools')

function csvEscapeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function executeIntegrationToolDirect(
  toolCall: ToolCallState,
  toolConfig: ToolConfig,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const { userId, workflowId } = context
  const toolName = resolveToolId(toolCall.name)
  const toolArgs = toolCall.params || {}

  let workspaceId = context.workspaceId
  if (!workspaceId && workflowId) {
    const wf = await getWorkflowById(workflowId)
    workspaceId = wf?.workspaceId ?? undefined
  }

  const decryptedEnvVars =
    context.decryptedEnvVars || (await getEffectiveDecryptedEnv(userId, workspaceId))

  const executionParams = resolveEnvVarReferences(toolArgs, decryptedEnvVars, {
    deep: true,
  }) as Record<string, unknown>

  // If the LLM passed a credential/oauthCredential ID directly, verify the user
  // has active credential_member access before proceeding. This prevents
  // unauthorized credential usage even if the agent hallucinated or received
  // a credential ID the user doesn't have access to.
  const suppliedCredentialId = (executionParams.credentialId ||
    executionParams.oauthCredential ||
    executionParams.credential) as string | undefined
  if (suppliedCredentialId) {
    const actorCtx = await getCredentialActorContext(suppliedCredentialId, userId)
    if (!actorCtx.member) {
      logger.warn('Blocked credential use: user lacks credential_member access', {
        credentialId: suppliedCredentialId,
        userId,
        toolName,
      })
      return {
        success: false,
        error: `You do not have access to credential "${suppliedCredentialId}". Ask the credential admin to add you as a member, or connect your own account.`,
      }
    }
  }

  if (toolConfig.oauth?.required && toolConfig.oauth.provider) {
    const provider = toolConfig.oauth.provider

    // Determine which credential to use: supplied by the LLM or auto-resolved
    let resolvedCredentialId = suppliedCredentialId

    if (!resolvedCredentialId) {
      if (!workspaceId) {
        return {
          success: false,
          error: `Cannot resolve ${provider} credential without a workspace context.`,
        }
      }

      const accessibleCreds = await getAccessibleOAuthCredentials(workspaceId, userId)
      const match = accessibleCreds.find((c) => c.providerId === provider)

      if (!match) {
        return {
          success: false,
          error: `No accessible ${provider} account found. You either don't have a ${provider} account connected in this workspace, or you don't have access to the existing one. Please connect your own account.`,
        }
      }

      resolvedCredentialId = match.id
    }

    const matchCtx = await getCredentialActorContext(resolvedCredentialId, userId)
    const accountId = matchCtx.credential?.accountId
    if (!accountId) {
      return {
        success: false,
        error: `OAuth account for ${provider} not found. Please reconnect your account.`,
      }
    }

    const [acc] = await db.select().from(account).where(eq(account.id, accountId)).limit(1)

    if (!acc) {
      return {
        success: false,
        error: `OAuth account for ${provider} not found. Please reconnect your account.`,
      }
    }

    const requestId = generateRequestId()
    const { accessToken } = await refreshTokenIfNeeded(requestId, acc, acc.id)

    if (!accessToken) {
      return {
        success: false,
        error: `OAuth token not available for ${provider}. Please reconnect your account.`,
      }
    }

    executionParams.accessToken = accessToken
  }

  const hasHostedKeySupport = isHosted && !!toolConfig.hosting
  if (toolConfig.params?.apiKey?.required && !executionParams.apiKey && !hasHostedKeySupport) {
    return {
      success: false,
      error: `API key not provided for ${toolName}. Use {{YOUR_API_KEY_ENV_VAR}} to reference your environment variable.`,
    }
  }

  executionParams._context = {
    workflowId,
    workspaceId,
    userId,
    enforceCredentialAccess: true,
  }

  if (toolName === 'function_execute') {
    executionParams.envVars = decryptedEnvVars
    executionParams.workflowVariables = {}
    executionParams.blockData = {}
    executionParams.blockNameMapping = {}
    executionParams.language = executionParams.language || 'javascript'
    executionParams.timeout = executionParams.timeout || 30000

    if (isHosted && workspaceId) {
      const sandboxFiles: Array<{ path: string; content: string }> = []
      const MAX_FILE_SIZE = 10 * 1024 * 1024
      const MAX_TOTAL_SIZE = 50 * 1024 * 1024
      const TEXT_EXTENSIONS = new Set([
        'csv',
        'json',
        'txt',
        'md',
        'html',
        'xml',
        'tsv',
        'yaml',
        'yml',
      ])
      let totalSize = 0

      const inputFileIds = executionParams.inputFiles as string[] | undefined
      if (inputFileIds?.length) {
        const allFiles = await listWorkspaceFiles(workspaceId)
        for (const fileRef of inputFileIds) {
          const record = findWorkspaceFileRecord(allFiles, fileRef)
          if (!record) {
            logger.warn('Sandbox input file not found', { fileRef })
            continue
          }
          const ext = record.name.split('.').pop()?.toLowerCase() ?? ''
          if (!TEXT_EXTENSIONS.has(ext)) {
            logger.warn('Skipping non-text sandbox input file', {
              fileId: record.id,
              fileName: record.name,
              ext,
            })
            continue
          }
          if (record.size > MAX_FILE_SIZE) {
            logger.warn('Sandbox input file exceeds size limit', {
              fileId: record.id,
              fileName: record.name,
              size: record.size,
            })
            continue
          }
          if (totalSize + record.size > MAX_TOTAL_SIZE) {
            logger.warn('Sandbox input total size limit reached, skipping remaining files')
            break
          }
          const buffer = await downloadWorkspaceFile(record)
          totalSize += buffer.length
          const textContent = buffer.toString('utf-8')
          sandboxFiles.push({
            path: getSandboxWorkspaceFilePath(record),
            content: textContent,
          })
          sandboxFiles.push({
            path: `/home/user/${record.name}`,
            content: textContent,
          })
        }
      }

      const inputTableIds = executionParams.inputTables as string[] | undefined
      if (inputTableIds?.length) {
        for (const tableId of inputTableIds) {
          const table = await getTableById(tableId)
          if (!table) {
            logger.warn('Sandbox input table not found', { tableId })
            continue
          }
          const { rows } = await queryRows(tableId, workspaceId, { limit: 10000 }, 'sandbox-input')
          const schema = table.schema as { columns: Array<{ name: string; type?: string }> }
          const cols = schema.columns.map((c) => c.name)
          const typeComment = `# types: ${schema.columns.map((c) => `${c.name}=${c.type || 'string'}`).join(', ')}`
          const csvLines = [typeComment, cols.join(',')]
          for (const row of rows) {
            csvLines.push(
              cols.map((c) => csvEscapeValue((row.data as Record<string, unknown>)[c])).join(',')
            )
          }
          const csvContent = csvLines.join('\n')
          if (totalSize + csvContent.length > MAX_TOTAL_SIZE) {
            logger.warn('Sandbox input total size limit reached, skipping remaining tables')
            break
          }
          totalSize += csvContent.length
          sandboxFiles.push({ path: `/home/user/tables/${tableId}.csv`, content: csvContent })
        }
      }

      if (sandboxFiles.length > 0) {
        executionParams._sandboxFiles = sandboxFiles
        logger.info('Prepared sandbox input files', {
          fileCount: sandboxFiles.length,
          totalSize,
          paths: sandboxFiles.map((f) => f.path),
        })
      }

      executionParams.inputFiles = undefined
      executionParams.inputTables = undefined
    }
  }

  const result = await executeTool(toolName, executionParams)

  return {
    success: result.success,
    output: result.output,
    error: result.error,
  }
}
