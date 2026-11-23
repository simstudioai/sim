/**
 * OpenTelemetry Integration for Sim Execution Pipeline
 *
 * This module integrates OpenTelemetry tracing with the existing execution logging system.
 * It converts TraceSpans and BlockLogs into proper OpenTelemetry spans with semantic conventions.
 *
 * Architecture:
 * - LoggingSession tracks workflow execution start/complete
 * - Executor generates BlockLogs for each block execution
 * - TraceSpans are built from BlockLogs
 * - This module converts TraceSpans -> OpenTelemetry Spans
 *
 * Integration Points:
 * 1. LoggingSession.start() -> Create root workflow span
 * 2. LoggingSession.complete() -> End workflow span with all block spans as children
 * 3. Block execution -> Create span for each block type with proper attributes
 */

import { context, type Span, SpanStatusCode, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import type { TraceSpan } from '@/lib/logs/types'
import { hostedKeyMetrics } from '@/lib/monitoring/metrics'
import { TraceAttr } from '@/lib/mothership/observability/trace-attributes'

/**
 * GenAI Semantic Convention Attributes
 */
const GenAIAttributes = {
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: TraceAttr.GenAiRequestModel,
  RESPONSE_MODEL: 'gen_ai.response.model',

  USAGE_INPUT_TOKENS: TraceAttr.GenAiUsageInputTokens,
  USAGE_OUTPUT_TOKENS: TraceAttr.GenAiUsageOutputTokens,
  USAGE_TOTAL_TOKENS: TraceAttr.GenAiUsageTotalTokens,

  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  REQUEST_TOP_P: 'gen_ai.request.top_p',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  RESPONSE_FINISH_REASON: 'gen_ai.response.finish_reason',

  AGENT_ID: TraceAttr.GenAiAgentId,
  AGENT_NAME: TraceAttr.GenAiAgentName,
  AGENT_TASK: 'gen_ai.agent.task',

  WORKFLOW_ID: TraceAttr.GenAiWorkflowId,
  WORKFLOW_NAME: TraceAttr.GenAiWorkflowName,
  WORKFLOW_VERSION: 'gen_ai.workflow.version',
  WORKFLOW_EXECUTION_ID: 'gen_ai.workflow.execution_id',

  TOOL_NAME: TraceAttr.GenAiToolName,
  TOOL_DESCRIPTION: 'gen_ai.tool.description',

  COST_TOTAL: TraceAttr.GenAiCostTotal,
  COST_INPUT: TraceAttr.GenAiCostInput,
  COST_OUTPUT: TraceAttr.GenAiCostOutput,
}

const logger = createLogger('OTelIntegration')

let _tracer: ReturnType<typeof trace.getTracer> | null = null

function getTracer() {
  if (!_tracer) {
    _tracer = trace.getTracer('sim-ai-platform', '1.0.0')
  }
  return _tracer
}

/**
 * Map block types to OpenTelemetry span kinds and semantic conventions
 */
const BLOCK_TYPE_MAPPING: Record<
  string,
  {
    spanName: string
    spanKind: string
    getAttributes: (traceSpan: TraceSpan) => Record<string, string | number | boolean | undefined>
  }
> = {
  agent: {
    spanName: 'gen_ai.agent.execute',
    spanKind: 'gen_ai.agent',
    getAttributes: (span) => {
      const attrs: Record<string, string | number | boolean | undefined> = {
        [GenAIAttributes.AGENT_ID]: span.blockId || span.id,
        [GenAIAttributes.AGENT_NAME]: span.name,
      }

      if (span.model) {
        attrs[GenAIAttributes.REQUEST_MODEL] = span.model
      }

      if (span.tokens) {
        // `TraceSpan.tokens` is typed as an object, but older persisted logs
        // stored it as a bare number (total). Keep the numeric branch for those
        // legacy rows.
        if (typeof span.tokens === 'number') {
          attrs[GenAIAttributes.USAGE_TOTAL_TOKENS] = span.tokens
        } else {
          attrs[GenAIAttributes.USAGE_INPUT_TOKENS] = span.tokens.input || span.tokens.prompt || 0
          attrs[GenAIAttributes.USAGE_OUTPUT_TOKENS] =
            span.tokens.output || span.tokens.completion || 0
          attrs[GenAIAttributes.USAGE_TOTAL_TOKENS] = span.tokens.total || 0
        }
      }

      if (span.cost) {
        attrs[GenAIAttributes.COST_INPUT] = span.cost.input || 0
        attrs[GenAIAttributes.COST_OUTPUT] = span.cost.output || 0
        attrs[GenAIAttributes.COST_TOTAL] = span.cost.total || 0
      }

      return attrs
    },
  },
  workflow: {
    spanName: 'gen_ai.workflow.execute',
    spanKind: 'gen_ai.workflow',
    getAttributes: (span) => ({
      [GenAIAttributes.WORKFLOW_ID]: span.blockId || 'root',
      [GenAIAttributes.WORKFLOW_NAME]: span.name,
    }),
  },
  tool: {
    spanName: 'gen_ai.tool.call',
    spanKind: 'gen_ai.tool',
    getAttributes: (span) => ({
      [GenAIAttributes.TOOL_NAME]: span.name,
      [TraceAttr.ToolId]: span.id,
      [TraceAttr.ToolDurationMs]: span.duration,
    }),
  },
  model: {
    spanName: 'gen_ai.model.request',
    spanKind: 'gen_ai.model',
    getAttributes: (span) => ({
      [TraceAttr.ModelName]: span.name,
      [TraceAttr.ModelId]: span.id,
      [TraceAttr.ModelDurationMs]: span.duration,
    }),
  },
  api: {
    spanName: 'http.client.request',
    spanKind: 'http.client',
    getAttributes: (span) => {
      const input = span.input as { method?: string; url?: string } | undefined
      const output = span.output as { status?: number } | undefined
      return {
        'http.request.method': input?.method || 'GET',
        'http.request.url': input?.url || '',
        'http.response.status_code': output?.status || 0,
        [TraceAttr.BlockId]: span.blockId,
        [TraceAttr.BlockName]: span.name,
      }
    },
  },
  function: {
    spanName: 'function.execute',
    spanKind: 'function',
    getAttributes: (span) => ({
      [TraceAttr.FunctionName]: span.name,
      [TraceAttr.FunctionId]: span.blockId,
      [TraceAttr.FunctionExecutionTimeMs]: span.duration,
    }),
  },
  router: {
    spanName: 'router.evaluate',
    spanKind: 'router',
    getAttributes: (span) => {
      const output = span.output as { selectedPath?: { blockId?: string } } | undefined
      return {
        [TraceAttr.RouterName]: span.name,
        [TraceAttr.RouterId]: span.blockId,
        [TraceAttr.RouterSelectedPath]: output?.selectedPath?.blockId,
      }
    },
  },
  condition: {
    spanName: 'condition.evaluate',
    spanKind: 'condition',
    getAttributes: (span) => {
      const output = span.output as { conditionResult?: boolean | string } | undefined
      return {
        [TraceAttr.ConditionName]: span.name,
        [TraceAttr.ConditionId]: span.blockId,
        [TraceAttr.ConditionResult]: output?.conditionResult,
      }
    },
  },
  loop: {
    spanName: 'loop.execute',
    spanKind: 'loop',
    getAttributes: (span) => ({
      [TraceAttr.LoopName]: span.name,
      [TraceAttr.LoopId]: span.blockId,
      [TraceAttr.LoopIterations]: span.children?.length || 0,
    }),
  },
  parallel: {
    spanName: 'parallel.execute',
    spanKind: 'parallel',
    getAttributes: (span) => ({
      [TraceAttr.ParallelName]: span.name,
      [TraceAttr.ParallelId]: span.blockId,
      [TraceAttr.ParallelBranches]: span.children?.length || 0,
    }),
  },
}

/**
 * Convert a TraceSpan to an OpenTelemetry span
 * Creates a proper OTel span with all the metadata from the trace span
 */
function createOTelSpanFromTraceSpan(traceSpan: TraceSpan, parentSpan?: Span): Span | null {
  try {
    const tracer = getTracer()

    const blockMapping = BLOCK_TYPE_MAPPING[traceSpan.type] || {
      spanName: `block.${traceSpan.type}`,
      spanKind: 'internal',
      getAttributes: (span: TraceSpan) => ({
        [TraceAttr.BlockType]: span.type,
        [TraceAttr.BlockId]: span.blockId,
        [TraceAttr.BlockName]: span.name,
      }),
    }

    const attributes = {
      ...blockMapping.getAttributes(traceSpan),
      [TraceAttr.SpanType]: traceSpan.type,
      [TraceAttr.SpanDurationMs]: traceSpan.duration,
      [TraceAttr.SpanStatus]: traceSpan.status,
    }

    const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : context.active()

    const span = tracer.startSpan(
      blockMapping.spanName,
      {
        attributes,
        startTime: new Date(traceSpan.startTime),
      },
      ctx
    )

    if (traceSpan.status === 'error') {
      const errorMessage =
        typeof traceSpan.output?.error === 'string'
          ? traceSpan.output.error
          : 'Block execution failed'

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorMessage,
      })

      if (errorMessage && errorMessage !== 'Block execution failed') {
        span.recordException(new Error(errorMessage))
      }
    } else {
      span.setStatus({ code: SpanStatusCode.OK })
    }

    if (traceSpan.children && traceSpan.children.length > 0) {
      for (const childTraceSpan of traceSpan.children) {
        createOTelSpanFromTraceSpan(childTraceSpan, span)
      }
    }

    if (traceSpan.toolCalls && traceSpan.toolCalls.length > 0) {
      for (const toolCall of traceSpan.toolCalls) {
        const toolSpan = tracer.startSpan(
          'gen_ai.tool.call',
          {
            attributes: {
              [GenAIAttributes.TOOL_NAME]: toolCall.name,
              [TraceAttr.ToolStatus]: toolCall.status,
              [TraceAttr.ToolDurationMs]: toolCall.duration || 0,
            },
            startTime: new Date(toolCall.startTime),
          },
          trace.setSpan(context.active(), span)
        )

        if (toolCall.status === 'error') {
          toolSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: toolCall.error || 'Tool call failed',
          })
          if (toolCall.error) {
            toolSpan.recordException(new Error(toolCall.error))
          }
        } else {
          toolSpan.setStatus({ code: SpanStatusCode.OK })
        }

        toolSpan.end(new Date(toolCall.endTime))
      }
    }

    span.end(new Date(traceSpan.endTime))

    return span
  } catch (error) {
    logger.error('Failed to create OTel span from trace span', {
      error,
      traceSpanId: traceSpan.id,
      traceSpanType: traceSpan.type,
    })
    return null
  }
}

/**
 * Create OpenTelemetry spans for an entire workflow execution
 * This is called from LoggingSession.complete() with the final trace spans
 */
export function createOTelSpansForWorkflowExecution(params: {
  workflowId: string
  workflowName?: string
  executionId: string
  traceSpans: TraceSpan[]
  trigger: string
  startTime: string
  endTime: string
  totalDurationMs: number
  status: 'success' | 'error'
}): void {
  try {
    const tracer = getTracer()

    const rootSpan = tracer.startSpan(
      'gen_ai.workflow.execute',
      {
        attributes: {
          [GenAIAttributes.WORKFLOW_ID]: params.workflowId,
          [GenAIAttributes.WORKFLOW_NAME]: params.workflowName || params.workflowId,
          [GenAIAttributes.WORKFLOW_EXECUTION_ID]: params.executionId,
          [TraceAttr.WorkflowTrigger]: params.trigger,
          [TraceAttr.WorkflowDurationMs]: params.totalDurationMs,
        },
        startTime: new Date(params.startTime),
      },
      context.active()
    )

    if (params.status === 'error') {
      rootSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Workflow execution failed',
      })
    } else {
      rootSpan.setStatus({ code: SpanStatusCode.OK })
    }

    for (const traceSpan of params.traceSpans) {
      createOTelSpanFromTraceSpan(traceSpan, rootSpan)
    }

    rootSpan.end(new Date(params.endTime))

    logger.debug('Created OTel spans for workflow execution', {
      workflowId: params.workflowId,
      executionId: params.executionId,
      spanCount: params.traceSpans.length,
    })
  } catch (error) {
    logger.error('Failed to create OTel spans for workflow execution', {
      error,
      workflowId: params.workflowId,
      executionId: params.executionId,
    })
  }
}

/**
 * Track platform events (workflow creation, knowledge base operations, etc.)
 */
function trackPlatformEvent(
  eventName: string,
  attributes: Record<string, string | number | boolean | string[]>
): void {
  try {
    const tracer = getTracer()
    const span = tracer.startSpan(eventName, {
      attributes: {
        ...attributes,
        [TraceAttr.EventName]: eventName,
        [TraceAttr.EventTimestamp]: Date.now(),
      },
    })
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  } catch {
    // Silently fail
  }
}

/**
 * Typed platform event tracking helpers.
 *
 * Naming convention: events are `platform.{resource}.{past_tense_action}`
 * (e.g. `platform.user.signed_up`); attributes are `{resource}.{attribute_name}`
 * (e.g. `user.id`, `workspace.id`).
 */
export const PlatformEvents = {
  /**
   * Track user sign up
   */
  userSignedUp: (attrs: {
    userId: string
    authMethod: 'email' | 'oauth' | 'sso'
    provider?: string
  }) => {
    trackPlatformEvent('platform.user.signed_up', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.UserAuthMethod]: attrs.authMethod,
      ...(attrs.provider && { [TraceAttr.UserAuthProvider]: attrs.provider }),
    })
  },

  /**
   * Track user sign in
   */
  userSignedIn: (attrs: {
    userId: string
    authMethod: 'email' | 'oauth' | 'sso'
    provider?: string
  }) => {
    trackPlatformEvent('platform.user.signed_in', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.UserAuthMethod]: attrs.authMethod,
      ...(attrs.provider && { [TraceAttr.UserAuthProvider]: attrs.provider }),
    })
  },

  /**
   * Track password reset requested
   */
  passwordResetRequested: (attrs: { userId: string }) => {
    trackPlatformEvent('platform.user.password_reset_requested', {
      [TraceAttr.UserId]: attrs.userId,
    })
  },

  /**
   * Track workspace created
   */
  workspaceCreated: (attrs: { workspaceId: string; userId: string; name: string }) => {
    trackPlatformEvent('platform.workspace.created', {
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
      [TraceAttr.WorkspaceName]: attrs.name,
      [TraceAttr.UserId]: attrs.userId,
    })
  },

  /**
   * Track member invited to workspace
   */
  workspaceMemberInvited: (attrs: {
    workspaceId: string
    invitedBy: string
    inviteeEmail: string
    role: string
    membershipIntent?: string
  }) => {
    trackPlatformEvent('platform.workspace.member_invited', {
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
      [TraceAttr.UserId]: attrs.invitedBy,
      [TraceAttr.InvitationRole]: attrs.role,
      ...(attrs.membershipIntent ? { 'invitation.membership_intent': attrs.membershipIntent } : {}),
    })
  },

  /**
   * Track member added directly to a workspace (no acceptance step) because
   * they were already a member of the workspace's organization.
   */
  workspaceMemberAdded: (attrs: {
    workspaceId: string
    addedBy: string
    addedUserId: string
    role: string
  }) => {
    trackPlatformEvent('platform.workspace.member_added', {
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
      [TraceAttr.UserId]: attrs.addedBy,
      'member.id': attrs.addedUserId,
      [TraceAttr.MemberRole]: attrs.role,
    })
  },

  /**
   * Track member joined workspace
   */
  workspaceMemberJoined: (attrs: { workspaceId: string; userId: string; role: string }) => {
    trackPlatformEvent('platform.workspace.member_joined', {
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.MemberRole]: attrs.role,
    })
  },

  /**
   * Track workflow created
   */
  workflowCreated: (attrs: {
    workflowId: string
    name: string
    workspaceId?: string
    folderId?: string
  }) => {
    trackPlatformEvent('platform.workflow.created', {
      [TraceAttr.WorkflowId]: attrs.workflowId,
      [TraceAttr.WorkflowName]: attrs.name,
      [TraceAttr.WorkflowHasWorkspace]: !!attrs.workspaceId,
      [TraceAttr.WorkflowHasFolder]: !!attrs.folderId,
    })
  },

  /**
   * Track workflow deleted
   */
  workflowDeleted: (attrs: { workflowId: string; workspaceId?: string }) => {
    trackPlatformEvent('platform.workflow.deleted', {
      [TraceAttr.WorkflowId]: attrs.workflowId,
      ...(attrs.workspaceId && { [TraceAttr.WorkspaceId]: attrs.workspaceId }),
    })
  },

  /**
   * Track workflow duplicated
   */
  workflowDuplicated: (attrs: {
    sourceWorkflowId: string
    newWorkflowId: string
    workspaceId?: string
  }) => {
    trackPlatformEvent('platform.workflow.duplicated', {
      [TraceAttr.WorkflowSourceId]: attrs.sourceWorkflowId,
      [TraceAttr.WorkflowNewId]: attrs.newWorkflowId,
      ...(attrs.workspaceId && { [TraceAttr.WorkspaceId]: attrs.workspaceId }),
    })
  },

  /**
   * Track workflow deployed
   */
  workflowDeployed: (attrs: {
    workflowId: string
    workflowName: string
    blocksCount: number
    edgesCount: number
    version: number
    loopsCount?: number
    parallelsCount?: number
    blockTypes?: string
  }) => {
    trackPlatformEvent('platform.workflow.deployed', {
      [TraceAttr.WorkflowId]: attrs.workflowId,
      [TraceAttr.WorkflowName]: attrs.workflowName,
      [TraceAttr.WorkflowBlocksCount]: attrs.blocksCount,
      [TraceAttr.WorkflowEdgesCount]: attrs.edgesCount,
      [TraceAttr.DeploymentVersion]: attrs.version,
      ...(attrs.loopsCount !== undefined && { [TraceAttr.WorkflowLoopsCount]: attrs.loopsCount }),
      ...(attrs.parallelsCount !== undefined && {
        [TraceAttr.WorkflowParallelsCount]: attrs.parallelsCount,
      }),
      ...(attrs.blockTypes && { [TraceAttr.WorkflowBlockTypes]: attrs.blockTypes }),
    })
  },

  /**
   * Track workflow undeployed
   */
  workflowUndeployed: (attrs: { workflowId: string }) => {
    trackPlatformEvent('platform.workflow.undeployed', {
      [TraceAttr.WorkflowId]: attrs.workflowId,
    })
  },

  /**
   * Track workflow executed
   */
  workflowExecuted: (attrs: {
    workflowId: string
    durationMs: number
    status: 'success' | 'error' | 'cancelled' | 'paused'
    trigger: string
    blocksExecuted: number
    hasErrors: boolean
    totalCost?: number
  }) => {
    trackPlatformEvent('platform.workflow.executed', {
      [TraceAttr.WorkflowId]: attrs.workflowId,
      [TraceAttr.ExecutionDurationMs]: attrs.durationMs,
      [TraceAttr.ExecutionStatus]: attrs.status,
      [TraceAttr.ExecutionTrigger]: attrs.trigger,
      [TraceAttr.ExecutionBlocksExecuted]: attrs.blocksExecuted,
      [TraceAttr.ExecutionHasErrors]: attrs.hasErrors,
      ...(attrs.totalCost !== undefined && { [TraceAttr.ExecutionTotalCost]: attrs.totalCost }),
    })
  },

  /**
   * Track knowledge base created
   */
  knowledgeBaseCreated: (attrs: {
    knowledgeBaseId: string
    name: string
    workspaceId?: string
  }) => {
    trackPlatformEvent('platform.knowledge_base.created', {
      'knowledge_base.id': attrs.knowledgeBaseId,
      'knowledge_base.name': attrs.name,
      ...(attrs.workspaceId && { [TraceAttr.WorkspaceId]: attrs.workspaceId }),
    })
  },

  /**
   * Track knowledge base deleted
   */
  knowledgeBaseDeleted: (attrs: { knowledgeBaseId: string }) => {
    trackPlatformEvent('platform.knowledge_base.deleted', {
      'knowledge_base.id': attrs.knowledgeBaseId,
    })
  },

  /**
   * Track documents uploaded to knowledge base
   */
  knowledgeBaseDocumentsUploaded: (attrs: {
    knowledgeBaseId: string
    documentsCount: number
    uploadType: 'single' | 'bulk'
    chunkSize?: number
    recipe?: string
    mimeType?: string
    fileSize?: number
  }) => {
    trackPlatformEvent('platform.knowledge_base.documents_uploaded', {
      'knowledge_base.id': attrs.knowledgeBaseId,
      [TraceAttr.DocumentsCount]: attrs.documentsCount,
      [TraceAttr.DocumentsUploadType]: attrs.uploadType,
      ...(attrs.chunkSize !== undefined && { [TraceAttr.ProcessingChunkSize]: attrs.chunkSize }),
      ...(attrs.recipe && { [TraceAttr.ProcessingRecipe]: attrs.recipe }),
      ...(attrs.mimeType && { [TraceAttr.DocumentMimeType]: attrs.mimeType }),
      ...(attrs.fileSize !== undefined && { [TraceAttr.DocumentFileSize]: attrs.fileSize }),
    })
  },

  /**
   * Track knowledge base searched
   */
  knowledgeBaseSearched: (attrs: {
    knowledgeBaseId: string
    knowledgeBaseIds: string[]
    documentIds: string[]
    connectorTypes: string[]
    resultsCount: number
    workspaceId?: string
    actorUserId?: string
    principalKind: string
    delegatedServiceId?: string
    /** Whether the search ran as a person (`user`) or as the workspace (`workspace`). */
    accessScopeKind?: 'user' | 'workspace'
    surface?: string
  }) => {
    trackPlatformEvent('platform.knowledge_base.searched', {
      'knowledge_base.id': attrs.knowledgeBaseId,
      'knowledge_base.ids': attrs.knowledgeBaseIds,
      'search.document_ids': attrs.documentIds,
      'search.documents_count': attrs.documentIds.length,
      'search.connector_types': attrs.connectorTypes,
      [TraceAttr.SearchResultsCount]: attrs.resultsCount,
      'search.principal_kind': attrs.principalKind,
      ...(attrs.workspaceId && { [TraceAttr.WorkspaceId]: attrs.workspaceId }),
      ...(attrs.actorUserId && { [TraceAttr.UserId]: attrs.actorUserId }),
      ...(attrs.delegatedServiceId && { 'search.delegated_service': attrs.delegatedServiceId }),
      ...(attrs.accessScopeKind && { 'search.access_scope_kind': attrs.accessScopeKind }),
      ...(attrs.surface && { 'search.surface': attrs.surface }),
    })
  },

  /**
   * Track API key generated
   */
  apiKeyGenerated: (attrs: { userId: string; keyName?: string }) => {
    trackPlatformEvent('platform.api_key.generated', {
      [TraceAttr.UserId]: attrs.userId,
      ...(attrs.keyName && { [TraceAttr.ApiKeyName]: attrs.keyName }),
    })
  },

  /**
   * Track API key revoked
   */
  apiKeyRevoked: (attrs: { userId: string; keyId: string }) => {
    trackPlatformEvent('platform.api_key.revoked', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.ApiKeyId]: attrs.keyId,
    })
  },

  /**
   * Track OAuth provider connected
   */
  oauthConnected: (attrs: { userId: string; provider: string; workspaceId?: string }) => {
    trackPlatformEvent('platform.oauth.connected', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.OauthProvider]: attrs.provider,
      ...(attrs.workspaceId && { [TraceAttr.WorkspaceId]: attrs.workspaceId }),
    })
  },

  /**
   * Track OAuth provider disconnected
   */
  oauthDisconnected: (attrs: { userId: string; provider: string }) => {
    trackPlatformEvent('platform.oauth.disconnected', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.OauthProvider]: attrs.provider,
    })
  },

  /**
   * Track webhook created
   */
  webhookCreated: (attrs: {
    webhookId: string
    workflowId: string
    provider: string
    workspaceId?: string
  }) => {
    trackPlatformEvent('platform.webhook.created', {
      [TraceAttr.WebhookId]: attrs.webhookId,
      [TraceAttr.WorkflowId]: attrs.workflowId,
      [TraceAttr.WebhookProvider]: attrs.provider,
      ...(attrs.workspaceId && { [TraceAttr.WorkspaceId]: attrs.workspaceId }),
    })
  },

  /**
   * Track webhook deleted
   */
  webhookDeleted: (attrs: { webhookId: string; workflowId: string }) => {
    trackPlatformEvent('platform.webhook.deleted', {
      [TraceAttr.WebhookId]: attrs.webhookId,
      [TraceAttr.WorkflowId]: attrs.workflowId,
    })
  },

  /**
   * Track webhook triggered
   */
  webhookTriggered: (attrs: {
    webhookId: string
    workflowId: string
    provider: string
    success: boolean
  }) => {
    trackPlatformEvent('platform.webhook.triggered', {
      [TraceAttr.WebhookId]: attrs.webhookId,
      [TraceAttr.WorkflowId]: attrs.workflowId,
      [TraceAttr.WebhookProvider]: attrs.provider,
      [TraceAttr.WebhookTriggerSuccess]: attrs.success,
    })
  },

  /**
   * Track MCP server added
   */
  mcpServerAdded: (attrs: {
    serverId: string
    serverName: string
    transport: string
    workspaceId: string
  }) => {
    trackPlatformEvent('platform.mcp.server_added', {
      [TraceAttr.McpServerId]: attrs.serverId,
      [TraceAttr.McpServerName]: attrs.serverName,
      [TraceAttr.McpTransport]: attrs.transport,
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
    })
  },

  /**
   * Track MCP tool executed
   */
  mcpToolExecuted: (attrs: {
    serverId: string
    toolName: string
    status: 'success' | 'error'
    workspaceId: string
  }) => {
    trackPlatformEvent('platform.mcp.tool_executed', {
      [TraceAttr.McpServerId]: attrs.serverId,
      [TraceAttr.McpToolName]: attrs.toolName,
      [TraceAttr.McpExecutionStatus]: attrs.status,
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
    })
  },

  /**
   * Track subscription created
   */
  subscriptionCreated: (attrs: {
    userId: string
    plan: string
    interval: 'monthly' | 'yearly'
  }) => {
    trackPlatformEvent('platform.billing.subscription_created', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.BillingPlan]: attrs.plan,
      [TraceAttr.BillingInterval]: attrs.interval,
    })
  },

  /**
   * Track subscription changed
   */
  subscriptionChanged: (attrs: {
    userId: string
    previousPlan: string
    newPlan: string
    changeType: 'upgrade' | 'downgrade'
  }) => {
    trackPlatformEvent('platform.billing.subscription_changed', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.BillingPreviousPlan]: attrs.previousPlan,
      [TraceAttr.BillingNewPlan]: attrs.newPlan,
      [TraceAttr.BillingChangeType]: attrs.changeType,
    })
  },

  /**
   * Track subscription cancelled
   */
  subscriptionCancelled: (attrs: { userId: string; plan: string }) => {
    trackPlatformEvent('platform.billing.subscription_cancelled', {
      [TraceAttr.UserId]: attrs.userId,
      [TraceAttr.BillingPlan]: attrs.plan,
    })
  },

  /**
   * Track folder created
   */
  folderCreated: (attrs: { folderId: string; name: string; workspaceId: string }) => {
    trackPlatformEvent('platform.folder.created', {
      'folder.id': attrs.folderId,
      'folder.name': attrs.name,
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
    })
  },

  /**
   * Track folder deleted
   */
  folderDeleted: (attrs: { folderId: string; workspaceId: string }) => {
    trackPlatformEvent('platform.folder.deleted', {
      'folder.id': attrs.folderId,
      [TraceAttr.WorkspaceId]: attrs.workspaceId,
    })
  },

  /**
   * Track when a rate limit error is surfaced to the end user (not retried/absorbed).
   * Fires for both billing-actor limits and exhausted upstream retries.
   */
  hostedKeyUserThrottled: (attrs: {
    toolId: string
    reason: 'billing_actor_limit' | 'upstream_retries_exhausted'
    provider?: string
    retryAfterMs?: number
    userId?: string
    workspaceId?: string
    workflowId?: string
  }) => {
    hostedKeyMetrics.recordThrottled({
      provider: attrs.provider ?? attrs.toolId,
      tool: attrs.toolId,
      reason: attrs.reason,
    })
  },

  /**
   * Track hosted key rate limited by upstream provider (429 from the external API)
   */
  hostedKeyRateLimited: (attrs: {
    toolId: string
    envVarName: string
    attempt: number
    maxRetries: number
    delayMs: number
    userId?: string
    workspaceId?: string
    workflowId?: string
  }) => {
    hostedKeyMetrics.recordUpstreamRateLimited({ tool: attrs.toolId, key: attrs.envVarName })
  },

  hostedKeyUnknownModelCost: (attrs: {
    toolId: string
    modelName: string
    defaultCost: number
  }) => {
    hostedKeyMetrics.recordUnknownModelCost({ tool: attrs.toolId })
  },

  /**
   * Track a successful hosted-key acquisition that had to wait — either for a slot at
   * the head of the FIFO queue, or for the actor/dimension bucket to refill once at the
   * head. `queuePosition` is the position at the moment of enqueue (0 = ready to proceed).
   */
  hostedKeyQueueWaited: (attrs: {
    provider: string
    workspaceId: string
    waitedMs: number
    attempts: number
    reason: 'actor_requests' | 'dimension' | 'queue_position'
    dimension?: string
    queuePosition?: number
  }) => {
    hostedKeyMetrics.recordQueueWait(attrs.waitedMs, {
      provider: attrs.provider,
      reason: attrs.reason,
    })
  },

  /**
   * Track a hosted-key acquisition that exceeded the queue wait cap and fell back to a 429.
   */
  hostedKeyQueueWaitExceeded: (attrs: {
    provider: string
    workspaceId: string
    waitedMs: number
    reason: 'actor_requests' | 'dimension' | 'queue_position'
    dimension?: string
  }) => {
    hostedKeyMetrics.recordQueueWaitExceeded({
      provider: attrs.provider,
      reason: attrs.reason,
    })
  },

  /**
   * Track chat deployed (workflow deployed as chat interface)
   */
  chatDeployed: (attrs: {
    chatId: string
    workflowId: string
    authType: 'public' | 'password' | 'email' | 'sso'
    hasOutputConfigs: boolean
  }) => {
    trackPlatformEvent('platform.chat.deployed', {
      [TraceAttr.ChatId]: attrs.chatId,
      [TraceAttr.WorkflowId]: attrs.workflowId,
      [TraceAttr.ChatAuthType]: attrs.authType,
      [TraceAttr.ChatHasOutputConfigs]: attrs.hasOutputConfigs,
    })
  },
}
