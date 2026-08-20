import { executeCopilotMcpServerUseCase } from '@/lib/copilot/application/execute-mcp-server-use-case'
import {
  executeCopilotWorkflowUseCase,
  messageForCopilotWorkflowError,
} from '@/lib/copilot/application/execute-workflow-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { resolveEnvReferenceSecretArg } from '@/lib/copilot/tools/server/env-reference'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  deployWorkflowMcpTool,
  undeployWorkflowMcpTool,
} from '@/lib/mcp/application/workflow-deployments'
import { buildWorkflowMcpApiEndpoint, buildWorkflowMcpServerUrl } from '@/lib/mcp/urls'
import {
  deployWorkflowChat,
  undeployWorkflowChat,
} from '@/lib/workflows/application/chat-deployments'
import { deployWorkflow, undeployWorkflow } from '@/lib/workflows/application/deployments'
import type { DeployApiParams, DeployChatParams, DeployMcpParams } from '../param-types'
import { getCopilotDeploymentIdempotencyKey, getHistoricalDeploymentAttemptError } from './context'

function buildWorkflowRunStatusEndpoint(
  baseUrl: string,
  apiEndpoint: string,
  runId: string
): string {
  if (
    !apiEndpoint.startsWith(`${baseUrl}/api/v2/workflows/`) ||
    !apiEndpoint.endsWith('/execute')
  ) {
    throw new Error(`Invalid workflow execution endpoint: ${apiEndpoint}`)
  }
  return `${apiEndpoint.slice(0, -'/execute'.length)}/runs/${runId}`
}

function buildWorkflowApiConfig(baseUrl: string, apiEndpoint: string) {
  return {
    endpoint: apiEndpoint,
    authentication: {
      type: 'api_key',
      acceptedHeaders: ['X-API-Key: YOUR_API_KEY', 'Authorization: Bearer YOUR_API_KEY'],
    },
    modes: {
      sync: {
        method: 'POST',
        transport: 'json',
        stream: false,
        body: { input: { key: 'value' } },
      },
      stream: {
        method: 'POST',
        transport: 'sse',
        stream: true,
        body: { stream: true, input: { key: 'value' } },
      },
      async: {
        method: 'POST',
        transport: 'json',
        stream: false,
        body: { async: true, input: { key: 'value' } },
        runStatusEndpointTemplate: buildWorkflowRunStatusEndpoint(baseUrl, apiEndpoint, '{runId}'),
      },
    },
  }
}

function buildWorkflowApiExamples(baseUrl: string, apiEndpoint: string) {
  return {
    sync: `curl -X POST "${apiEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"input":{"key":"value"}}'`,
    stream: `curl -N -X POST "${apiEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"stream":true,"input":{"key":"value"}}'`,
    async: `curl -X POST "${apiEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"async":true,"input":{"key":"value"}}'`,
    poll: `curl "${buildWorkflowRunStatusEndpoint(baseUrl, apiEndpoint, 'RUN_ID')}" \\
  -H "X-API-Key: YOUR_API_KEY"`,
  }
}

/** Returns an error until this call's admitted version is the active production version. */
function getUnconfirmedDeploymentError(
  result: Awaited<ReturnType<typeof deployWorkflow.execute>>,
  action: string
): string | null {
  const attempt = result.latestDeploymentAttempt
  const activeVersionId = result.activeDeployment?.deploymentVersionId
  if (
    attempt?.status === 'active' &&
    result.deploymentVersionId !== undefined &&
    activeVersionId === result.deploymentVersionId
  ) {
    return null
  }

  const versionLabel = result.version === undefined ? '' : ` v${result.version}`
  const status = attempt?.status ?? 'unknown'
  const detail = result.warnings?.[0] ?? `${action}${versionLabel} is ${status}, not active.`
  return `${detail} Do not submit a new deployment; check the existing attempt's status.`
}

function buildMcpClientExamples(serverName: string, serverUrl: string) {
  return {
    cursor: {
      mcpServers: {
        [serverName]: {
          url: serverUrl,
          headers: { 'X-API-Key': 'YOUR_API_KEY' },
        },
      },
    },
    claudeCode: `claude mcp add ${serverName} --url "${serverUrl}" --header "X-API-Key: YOUR_API_KEY"`,
    claudeDesktop: {
      mcpServers: {
        [serverName]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', serverUrl, '--header', 'X-API-Key:YOUR_API_KEY'],
        },
      },
    },
    vscode: {
      mcp: {
        servers: {
          [serverName]: {
            type: 'http',
            url: serverUrl,
            headers: { 'X-API-Key': 'YOUR_API_KEY' },
          },
        },
      },
    },
  }
}

export async function executeDeployApi(
  params: DeployApiParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    if (action === 'undeploy') {
      const result = await executeCopilotWorkflowUseCase(context, undeployWorkflow, {
        workflowId,
        assertedWorkspaceId: context.workspaceId,
        requestId: generateRequestId(),
      })
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to undeploy workflow' }
      }
      const baseUrl = getBaseUrl()
      const apiEndpoint = buildWorkflowMcpApiEndpoint(workflowId)
      return {
        success: true,
        output: {
          workflowId,
          isDeployed: false,
          apiEndpoint,
          baseUrl,
          deploymentType: 'api',
          deploymentStatus: {
            api: {
              isDeployed: false,
              endpoint: apiEndpoint,
            },
          },
          deploymentConfig: {
            api: buildWorkflowApiConfig(baseUrl, apiEndpoint),
          },
          examples: {
            api: {
              curl: buildWorkflowApiExamples(baseUrl, apiEndpoint),
            },
          },
        },
      }
    }

    const versionDescription = params.versionDescription?.trim()
    if (!versionDescription) {
      return {
        success: false,
        error:
          'versionDescription is required when deploying. Provide a concise summary of what changed in this deployment version (call diff_workflows with ref1 "live" and ref2 "draft" if unsure what changed).',
      }
    }

    const versionName = params.versionName?.trim()
    if (!versionName) {
      return {
        success: false,
        error:
          'versionName is required when deploying. Provide a short human-readable label for this deployment version.',
      }
    }

    const result = await executeCopilotWorkflowUseCase(context, deployWorkflow, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      description: versionDescription,
      name: versionName,
      requestId: generateRequestId(),
      idempotencyKey: getCopilotDeploymentIdempotencyKey(context, 'deploy_as_api'),
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to deploy workflow' }
    }
    const historicalAttemptError = getHistoricalDeploymentAttemptError(
      result.latestDeploymentAttempt,
      'deploy'
    )
    if (historicalAttemptError) return { success: false, error: historicalAttemptError }
    const unconfirmedDeploymentError = getUnconfirmedDeploymentError(result, 'Deployment')
    if (unconfirmedDeploymentError) {
      return { success: false, error: unconfirmedDeploymentError }
    }

    const baseUrl = getBaseUrl()
    const apiEndpoint = buildWorkflowMcpApiEndpoint(workflowId)
    const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
    const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
    const isDeployed = Boolean(result.activeDeployment)
    return {
      success: true,
      output: {
        workflowId,
        isDeployed,
        deployedAt: result.deployedAt,
        version: result.version,
        lifecycleStatus: result.latestDeploymentAttempt?.status ?? null,
        readiness: result.latestDeploymentAttempt?.readiness ?? null,
        error: result.latestDeploymentAttempt?.error ?? null,
        warnings: result.warnings ?? [],
        apiEndpoint,
        baseUrl,
        deploymentType: 'api',
        deploymentStatus: {
          api: {
            isDeployed,
            endpoint: apiEndpoint,
            deployedAt: result.deployedAt,
            version: result.version,
          },
        },
        deploymentConfig: {
          api: apiConfig,
        },
        examples: {
          api: {
            curl: apiExamples,
          },
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to update API deployment'),
    }
  }
}

export async function executeDeployChat(
  params: DeployChatParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const action = params.action === 'undeploy' ? 'undeploy' : 'deploy'
    if (action === 'undeploy') {
      const { deployment } = await executeCopilotWorkflowUseCase(context, undeployWorkflowChat, {
        workflowId,
        assertedWorkspaceId: context.workspaceId,
      })
      const baseUrl = getBaseUrl()
      const apiEndpoint = buildWorkflowMcpApiEndpoint(workflowId)
      const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
      const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
      return {
        success: true,
        output: {
          workflowId,
          success: true,
          action: 'undeploy',
          isDeployed: true,
          isChatDeployed: false,
          deploymentType: 'chat',
          apiEndpoint,
          baseUrl,
          deploymentStatus: {
            api: {
              isDeployed: true,
              endpoint: apiEndpoint,
            },
            chat: {
              isDeployed: false,
              identifier: deployment.identifier,
              title: deployment.title,
            },
          },
          deploymentConfig: {
            api: apiConfig,
            chat: {
              identifier: deployment.identifier,
              title: deployment.title,
              description: deployment.description || '',
              authType: deployment.authType,
              allowedEmails: (deployment.allowedEmails as string[]) || [],
              outputConfigs:
                (deployment.outputConfigs as Array<{ blockId: string; path: string }>) || [],
              includeThinking: deployment.includeThinking ?? false,
              includeToolCalls: deployment.includeToolCalls ?? false,
              welcomeMessage:
                (deployment.customizations as { welcomeMessage?: string } | null)?.welcomeMessage ||
                'Hi there! How can I help you today?',
            },
          },
          examples: {
            api: {
              curl: apiExamples,
            },
          },
        },
      }
    }

    const versionDescription = params.versionDescription?.trim()
    if (!versionDescription) {
      return {
        success: false,
        error:
          'versionDescription is required when deploying. Provide a concise summary of what changed in this deployment version (distinct from the chat-facing description; call diff_workflows with ref1 "live" and ref2 "draft" if unsure).',
      }
    }

    const versionName = params.versionName?.trim()
    if (!versionName) {
      return {
        success: false,
        error:
          'versionName is required when deploying. Provide a short human-readable label for this deployment version (distinct from the chat title).',
      }
    }

    // "Use the password in {{CHAT_PW}}" arrives as the literal reference —
    // resolve it, or the placeholder string becomes the chat's real password.
    const resolvedPassword = await resolveEnvReferenceSecretArg({
      userId: context.userId,
      workspaceId: context.workspaceId,
      value: params.password ?? undefined,
      argName: 'password',
      registry: context.resolvedSecretTraceRegistry,
    })
    if (resolvedPassword.error) {
      return { success: false, error: resolvedPassword.error }
    }

    const result = await executeCopilotWorkflowUseCase(context, deployWorkflowChat, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      identifier: params.identifier,
      title: params.title,
      description: params.description,
      versionDescription,
      versionName,
      customizations: {
        primaryColor: params.customizations?.primaryColor,
        welcomeMessage: params.welcomeMessage ?? params.customizations?.welcomeMessage,
        imageUrl: params.customizations?.imageUrl ?? params.customizations?.iconUrl,
      },
      authType: params.authType,
      password: resolvedPassword.value,
      allowedEmails: params.allowedEmails,
      outputConfigs: params.outputConfigs,
      includeThinking: params.includeThinking,
      includeToolCalls: params.includeToolCalls,
      requestId: generateRequestId(),
      idempotencyKey: getCopilotDeploymentIdempotencyKey(context, 'deploy_as_chat'),
    })

    const baseUrl = getBaseUrl()
    const apiEndpoint = buildWorkflowMcpApiEndpoint(workflowId)
    const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
    const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
    return {
      success: true,
      output: {
        workflowId,
        success: true,
        action: 'deploy',
        isDeployed: true,
        isChatDeployed: true,
        identifier: result.identifier,
        chatUrl: result.chatUrl,
        apiEndpoint,
        baseUrl,
        deployedAt: result.deployedAt || null,
        version: result.version,
        deploymentType: 'chat',
        deploymentStatus: {
          api: {
            isDeployed: true,
            endpoint: apiEndpoint,
            deployedAt: result.deployedAt || null,
            version: result.version,
          },
          chat: {
            isDeployed: true,
            identifier: result.identifier,
            chatUrl: result.chatUrl,
            title: result.title,
            description: result.description,
            authType: result.authType,
          },
        },
        deploymentConfig: {
          api: apiConfig,
          chat: {
            identifier: result.identifier,
            chatUrl: result.chatUrl,
            title: result.title,
            description: result.description,
            authType: result.authType,
            allowedEmails: result.allowedEmails,
            outputConfigs: result.outputConfigs,
            includeThinking: result.includeThinking,
            includeToolCalls: result.includeToolCalls,
            ...result.customizations,
          },
        },
        examples: {
          chat: {
            open: result.chatUrl,
          },
          api: {
            curl: apiExamples,
          },
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to update chat deployment'),
    }
  }
}

export async function executeDeployMcp(
  params: DeployMcpParams,
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }

    const serverId = params.serverId
    if (!serverId) {
      return {
        success: false,
        error: 'serverId is required. Use list_workspace_mcp_servers to get available servers.',
      }
    }
    if (params.action === 'undeploy') {
      const result = await executeCopilotMcpServerUseCase(context, undeployWorkflowMcpTool, {
        serverId,
        workflowId,
      })
      return {
        success: true,
        output: {
          workflowId,
          serverId,
          serverName: result.server.name,
          action: 'undeploy',
          removed: true,
          deploymentType: 'mcp',
          deploymentStatus: {
            mcp: {
              isDeployed: false,
              serverId,
              serverName: result.server.name,
            },
          },
        },
      }
    }

    const result = await executeCopilotMcpServerUseCase(context, deployWorkflowMcpTool, {
      serverId,
      workflowId,
      toolName: params.toolName,
      toolDescription: params.toolDescription,
      parameterDescriptions: params.parameterDescriptions,
    })
    const baseUrl = getBaseUrl()
    const mcpServerUrl = buildWorkflowMcpServerUrl(serverId)
    const apiEndpoint = buildWorkflowMcpApiEndpoint(workflowId)
    const clientExamples = buildMcpClientExamples(result.server.name, mcpServerUrl)
    const toolId = result.tool.id
    const toolName = result.tool.toolName
    const toolDescription = result.tool.toolDescription

    return {
      success: true,
      output: {
        toolId,
        toolName,
        toolDescription,
        updated: result.updated,
        mcpServerUrl,
        baseUrl,
        serverId,
        serverName: result.server.name,
        deploymentType: 'mcp',
        apiEndpoint,
        deploymentStatus: {
          api: {
            isDeployed: true,
            endpoint: apiEndpoint,
          },
          mcp: {
            isDeployed: true,
            serverId,
            serverName: result.server.name,
            toolId,
            toolName,
            updated: result.updated,
          },
        },
        deploymentConfig: {
          mcp: {
            serverId,
            serverName: result.server.name,
            serverUrl: mcpServerUrl,
            toolId,
            toolName,
            toolDescription,
            parameterSchema: result.parameterSchema,
            authentication: {
              type: 'api_key',
              header: 'X-API-Key: YOUR_API_KEY',
            },
          },
        },
        examples: {
          mcp: clientExamples,
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to update MCP deployment'),
    }
  }
}

export async function executeRedeploy(
  params: { workflowId?: string; versionDescription?: string; versionName?: string },
  context: ExecutionContext
): Promise<ToolCallResult> {
  try {
    const workflowId = params.workflowId || context.workflowId
    if (!workflowId) {
      return { success: false, error: 'workflowId is required' }
    }
    const versionDescription = params.versionDescription?.trim()
    if (!versionDescription) {
      return {
        success: false,
        error:
          'versionDescription is required. Provide a concise summary of what changed in this deployment version (call diff_workflows with ref1 "live" and ref2 "draft" if unsure what changed).',
      }
    }
    const versionName = params.versionName?.trim()
    if (!versionName) {
      return {
        success: false,
        error:
          'versionName is required. Provide a short human-readable label for this deployment version.',
      }
    }
    const result = await executeCopilotWorkflowUseCase(context, deployWorkflow, {
      workflowId,
      assertedWorkspaceId: context.workspaceId,
      description: versionDescription,
      name: versionName,
      requestId: generateRequestId(),
      idempotencyKey: getCopilotDeploymentIdempotencyKey(context, 'deploy_as_api'),
    })
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to redeploy workflow' }
    }
    const historicalAttemptError = getHistoricalDeploymentAttemptError(
      result.latestDeploymentAttempt,
      'redeploy'
    )
    if (historicalAttemptError) return { success: false, error: historicalAttemptError }
    const unconfirmedDeploymentError = getUnconfirmedDeploymentError(result, 'Redeployment')
    if (unconfirmedDeploymentError) {
      return { success: false, error: unconfirmedDeploymentError }
    }
    const baseUrl = getBaseUrl()
    const apiEndpoint = buildWorkflowMcpApiEndpoint(workflowId)
    const apiConfig = buildWorkflowApiConfig(baseUrl, apiEndpoint)
    const apiExamples = buildWorkflowApiExamples(baseUrl, apiEndpoint)
    const isDeployed = Boolean(result.activeDeployment)
    return {
      success: true,
      output: {
        workflowId,
        isDeployed,
        deployedAt: result.deployedAt || null,
        version: result.version,
        lifecycleStatus: result.latestDeploymentAttempt?.status ?? null,
        readiness: result.latestDeploymentAttempt?.readiness ?? null,
        error: result.latestDeploymentAttempt?.error ?? null,
        warnings: result.warnings ?? [],
        apiEndpoint,
        baseUrl,
        deploymentType: 'api',
        deploymentStatus: {
          api: {
            isDeployed,
            endpoint: apiEndpoint,
            deployedAt: result.deployedAt || null,
            version: result.version,
          },
        },
        deploymentConfig: {
          api: apiConfig,
        },
        examples: {
          api: {
            curl: apiExamples,
          },
        },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: messageForCopilotWorkflowError(error, 'Failed to redeploy workflow'),
    }
  }
}
