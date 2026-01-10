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

/**
 * GenAI Semantic Convention Attributes
 */
const GenAIAttributes = {
  // System attributes
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',

  // Token usage
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',

  // Request/Response
  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  REQUEST_TOP_P: 'gen_ai.request.top_p',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  RESPONSE_FINISH_REASON: 'gen_ai.response.finish_reason',

  // Agent-specific
  AGENT_ID: 'gen_ai.agent.id',
  AGENT_NAME: 'gen_ai.agent.name',
  AGENT_TASK: 'gen_ai.agent.task',

  // Workflow-specific
  WORKFLOW_ID: 'gen_ai.workflow.id',
  WORKFLOW_NAME: 'gen_ai.workflow.name',
  WORKFLOW_VERSION: 'gen_ai.workflow.version',
  WORKFLOW_EXECUTION_ID: 'gen_ai.workflow.execution_id',

  // Tool-specific
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_DESCRIPTION: 'gen_ai.tool.description',

  // Cost tracking
  COST_TOTAL: 'gen_ai.cost.total',
  COST_INPUT: 'gen_ai.cost.input',
  COST_OUTPUT: 'gen_ai.cost.output',
}

const logger = createLogger('OTelIntegration')

// Lazy-load tracer
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
      'tool.id': span.id,
      'tool.duration_ms': span.duration,
    }),
  },
  model: {
    spanName: 'gen_ai.model.request',
    spanKind: 'gen_ai.model',
    getAttributes: (span) => ({
      'model.name': span.name,
      'model.id': span.id,
      'model.duration_ms': span.duration,
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
        'block.id': span.blockId,
        'block.name': span.name,
      }
    },
  },
  function: {
    spanName: 'function.execute',
    spanKind: 'function',
    getAttributes: (span) => ({
      'function.name': span.name,
      'function.id': span.blockId,
      'function.execution_time_ms': span.duration,
    }),
  },
  router: {
    spanName: 'router.evaluate',
    spanKind: 'router',
    getAttributes: (span) => {
      const output = span.output as { selectedPath?: { blockId?: string } } | undefined
      return {
        'router.name': span.name,
        'router.id': span.blockId,
        'router.selected_path': output?.selectedPath?.blockId,
      }
    },
  },
  condition: {
    spanName: 'condition.evaluate',
    spanKind: 'condition',
    getAttributes: (span) => {
      const output = span.output as { conditionResult?: boolean | string } | undefined
      return {
        'condition.name': span.name,
        'condition.id': span.blockId,
        'condition.result': output?.conditionResult,
      }
    },
  },
  loop: {
    spanName: 'loop.execute',
    spanKind: 'loop',
    getAttributes: (span) => ({
      'loop.name': span.name,
      'loop.id': span.blockId,
      'loop.iterations': span.children?.length || 0,
    }),
  },
  parallel: {
    spanName: 'parallel.execute',
    spanKind: 'parallel',
    getAttributes: (span) => ({
      'parallel.name': span.name,
      'parallel.id': span.blockId,
      'parallel.branches': span.children?.length || 0,
    }),
  },
}

/**
 * Convert a TraceSpan to an OpenTelemetry span
 * Creates a proper OTel span with all the metadata from the trace span
 */
export function createOTelSpanFromTraceSpan(traceSpan: TraceSpan, parentSpan?: Span): Span | null {
  try {
    const tracer = getTracer()

    const blockMapping = BLOCK_TYPE_MAPPING[traceSpan.type] || {
      spanName: `block.${traceSpan.type}`,
      spanKind: 'internal',
      getAttributes: (span: TraceSpan) => ({
        'block.type': span.type,
        'block.id': span.blockId,
        'block.name': span.name,
      }),
    }

    const attributes = {
      ...blockMapping.getAttributes(traceSpan),
      'span.type': traceSpan.type,
      'span.duration_ms': traceSpan.duration,
      'span.status': traceSpan.status,
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
              'tool.status': toolCall.status,
              'tool.duration_ms': toolCall.duration || 0,
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
  error?: string
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
          'workflow.trigger': params.trigger,
          'workflow.duration_ms': params.totalDurationMs,
        },
        startTime: new Date(params.startTime),
      },
      context.active()
    )

    if (params.status === 'error') {
      rootSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: params.error || 'Workflow execution failed',
      })
      if (params.error) {
        rootSpan.recordException(new Error(params.error))
      }
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
 * Create a real-time OpenTelemetry span for a block execution
 * Can be called from block handlers during execution for real-time tracing
 */
export async function traceBlockExecution<T>(
  blockType: string,
  blockId: string,
  blockName: string,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer()

  const blockMapping = BLOCK_TYPE_MAPPING[blockType] || {
    spanName: `block.${blockType}`,
    spanKind: 'internal',
    getAttributes: () => ({}),
  }

  return tracer.startActiveSpan(
    blockMapping.spanName,
    {
      attributes: {
        'block.type': blockType,
        'block.id': blockId,
        'block.name': blockName,
      },
    },
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Block execution failed',
        })
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        throw error
      } finally {
        span.end()
      }
    }
  )
}

/**
 * Track platform events (workflow creation, knowledge base operations, etc.)
 */
export function trackPlatformEvent(
  eventName: string,
  attributes: Record<string, string | number | boolean>
): void {
  try {
    const tracer = getTracer()
    const span = tracer.startSpan(eventName, {
      attributes: {
        ...attributes,
        'event.name': eventName,
        'event.timestamp': Date.now(),
      },
    })
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  } catch (error) {
    // Silently fail
  }
}

// ============================================================================
// PLATFORM TELEMETRY EVENTS
// ============================================================================
//
// Naming Convention:
//   Event:     platform.{resource}.{past_tense_action}
//   Attribute: {resource}.{attribute_name}
//
// Examples:
//   Event:     platform.user.signed_up
//   Attribute: user.id, user.auth_method, workspace.id
//
// Categories:
//   - User/Auth:      platform.user.*
//   - Workspace:      platform.workspace.*
//   - Workflow:       platform.workflow.*
//   - Knowledge Base: platform.knowledge_base.*
//   - MCP:            platform.mcp.*
//   - API Keys:       platform.api_key.*
//   - OAuth:          platform.oauth.*
//   - Webhook:        platform.webhook.*
//   - Billing:        platform.billing.*
//   - Template:       platform.template.*
// ============================================================================

/**
 * Platform Events - Typed event tracking helpers
 * These provide type-safe, consistent telemetry across the platform
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
      'user.id': attrs.userId,
      'user.auth_method': attrs.authMethod,
      ...(attrs.provider && { 'user.auth_provider': attrs.provider }),
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
      'user.id': attrs.userId,
      'user.auth_method': attrs.authMethod,
      ...(attrs.provider && { 'user.auth_provider': attrs.provider }),
    })
  },

  /**
   * Track password reset requested
   */
  passwordResetRequested: (attrs: { userId: string }) => {
    trackPlatformEvent('platform.user.password_reset_requested', {
      'user.id': attrs.userId,
    })
  },

  /**
   * Track workspace created
   */
  workspaceCreated: (attrs: { workspaceId: string; userId: string; name: string }) => {
    trackPlatformEvent('platform.workspace.created', {
      'workspace.id': attrs.workspaceId,
      'workspace.name': attrs.name,
      'user.id': attrs.userId,
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
  }) => {
    trackPlatformEvent('platform.workspace.member_invited', {
      'workspace.id': attrs.workspaceId,
      'user.id': attrs.invitedBy,
      'invitation.role': attrs.role,
    })
  },

  /**
   * Track member joined workspace
   */
  workspaceMemberJoined: (attrs: { workspaceId: string; userId: string; role: string }) => {
    trackPlatformEvent('platform.workspace.member_joined', {
      'workspace.id': attrs.workspaceId,
      'user.id': attrs.userId,
      'member.role': attrs.role,
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
      'workflow.id': attrs.workflowId,
      'workflow.name': attrs.name,
      'workflow.has_workspace': !!attrs.workspaceId,
      'workflow.has_folder': !!attrs.folderId,
    })
  },

  /**
   * Track workflow deleted
   */
  workflowDeleted: (attrs: { workflowId: string; workspaceId?: string }) => {
    trackPlatformEvent('platform.workflow.deleted', {
      'workflow.id': attrs.workflowId,
      ...(attrs.workspaceId && { 'workspace.id': attrs.workspaceId }),
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
      'workflow.source_id': attrs.sourceWorkflowId,
      'workflow.new_id': attrs.newWorkflowId,
      ...(attrs.workspaceId && { 'workspace.id': attrs.workspaceId }),
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
      'workflow.id': attrs.workflowId,
      'workflow.name': attrs.workflowName,
      'workflow.blocks_count': attrs.blocksCount,
      'workflow.edges_count': attrs.edgesCount,
      'deployment.version': attrs.version,
      ...(attrs.loopsCount !== undefined && { 'workflow.loops_count': attrs.loopsCount }),
      ...(attrs.parallelsCount !== undefined && {
        'workflow.parallels_count': attrs.parallelsCount,
      }),
      ...(attrs.blockTypes && { 'workflow.block_types': attrs.blockTypes }),
    })
  },

  /**
   * Track workflow undeployed
   */
  workflowUndeployed: (attrs: { workflowId: string }) => {
    trackPlatformEvent('platform.workflow.undeployed', {
      'workflow.id': attrs.workflowId,
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
    errorMessage?: string
  }) => {
    trackPlatformEvent('platform.workflow.executed', {
      'workflow.id': attrs.workflowId,
      'execution.duration_ms': attrs.durationMs,
      'execution.status': attrs.status,
      'execution.trigger': attrs.trigger,
      'execution.blocks_executed': attrs.blocksExecuted,
      'execution.has_errors': attrs.hasErrors,
      ...(attrs.totalCost !== undefined && { 'execution.total_cost': attrs.totalCost }),
      ...(attrs.errorMessage && { 'execution.error_message': attrs.errorMessage }),
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
      ...(attrs.workspaceId && { 'workspace.id': attrs.workspaceId }),
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
      'documents.count': attrs.documentsCount,
      'documents.upload_type': attrs.uploadType,
      ...(attrs.chunkSize !== undefined && { 'processing.chunk_size': attrs.chunkSize }),
      ...(attrs.recipe && { 'processing.recipe': attrs.recipe }),
      ...(attrs.mimeType && { 'document.mime_type': attrs.mimeType }),
      ...(attrs.fileSize !== undefined && { 'document.file_size': attrs.fileSize }),
    })
  },

  /**
   * Track knowledge base searched
   */
  knowledgeBaseSearched: (attrs: {
    knowledgeBaseId: string
    resultsCount: number
    workspaceId?: string
  }) => {
    trackPlatformEvent('platform.knowledge_base.searched', {
      'knowledge_base.id': attrs.knowledgeBaseId,
      'search.results_count': attrs.resultsCount,
      ...(attrs.workspaceId && { 'workspace.id': attrs.workspaceId }),
    })
  },

  /**
   * Track API key generated
   */
  apiKeyGenerated: (attrs: { userId: string; keyName?: string }) => {
    trackPlatformEvent('platform.api_key.generated', {
      'user.id': attrs.userId,
      ...(attrs.keyName && { 'api_key.name': attrs.keyName }),
    })
  },

  /**
   * Track API key revoked
   */
  apiKeyRevoked: (attrs: { userId: string; keyId: string }) => {
    trackPlatformEvent('platform.api_key.revoked', {
      'user.id': attrs.userId,
      'api_key.id': attrs.keyId,
    })
  },

  /**
   * Track OAuth provider connected
   */
  oauthConnected: (attrs: { userId: string; provider: string; workspaceId?: string }) => {
    trackPlatformEvent('platform.oauth.connected', {
      'user.id': attrs.userId,
      'oauth.provider': attrs.provider,
      ...(attrs.workspaceId && { 'workspace.id': attrs.workspaceId }),
    })
  },

  /**
   * Track OAuth provider disconnected
   */
  oauthDisconnected: (attrs: { userId: string; provider: string }) => {
    trackPlatformEvent('platform.oauth.disconnected', {
      'user.id': attrs.userId,
      'oauth.provider': attrs.provider,
    })
  },

  /**
   * Track credential set created
   */
  credentialSetCreated: (attrs: { credentialSetId: string; userId: string; name: string }) => {
    trackPlatformEvent('platform.credential_set.created', {
      'credential_set.id': attrs.credentialSetId,
      'credential_set.name': attrs.name,
      'user.id': attrs.userId,
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
      'webhook.id': attrs.webhookId,
      'workflow.id': attrs.workflowId,
      'webhook.provider': attrs.provider,
      ...(attrs.workspaceId && { 'workspace.id': attrs.workspaceId }),
    })
  },

  /**
   * Track webhook deleted
   */
  webhookDeleted: (attrs: { webhookId: string; workflowId: string }) => {
    trackPlatformEvent('platform.webhook.deleted', {
      'webhook.id': attrs.webhookId,
      'workflow.id': attrs.workflowId,
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
      'webhook.id': attrs.webhookId,
      'workflow.id': attrs.workflowId,
      'webhook.provider': attrs.provider,
      'webhook.trigger_success': attrs.success,
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
      'mcp.server_id': attrs.serverId,
      'mcp.server_name': attrs.serverName,
      'mcp.transport': attrs.transport,
      'workspace.id': attrs.workspaceId,
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
      'mcp.server_id': attrs.serverId,
      'mcp.tool_name': attrs.toolName,
      'mcp.execution_status': attrs.status,
      'workspace.id': attrs.workspaceId,
    })
  },

  /**
   * Track template used
   */
  templateUsed: (attrs: {
    templateId: string
    templateName: string
    newWorkflowId: string
    blocksCount: number
    workspaceId: string
  }) => {
    trackPlatformEvent('platform.template.used', {
      'template.id': attrs.templateId,
      'template.name': attrs.templateName,
      'workflow.created_id': attrs.newWorkflowId,
      'workflow.blocks_count': attrs.blocksCount,
      'workspace.id': attrs.workspaceId,
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
      'user.id': attrs.userId,
      'billing.plan': attrs.plan,
      'billing.interval': attrs.interval,
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
      'user.id': attrs.userId,
      'billing.previous_plan': attrs.previousPlan,
      'billing.new_plan': attrs.newPlan,
      'billing.change_type': attrs.changeType,
    })
  },

  /**
   * Track subscription cancelled
   */
  subscriptionCancelled: (attrs: { userId: string; plan: string }) => {
    trackPlatformEvent('platform.billing.subscription_cancelled', {
      'user.id': attrs.userId,
      'billing.plan': attrs.plan,
    })
  },

  /**
   * Track folder created
   */
  folderCreated: (attrs: { folderId: string; name: string; workspaceId: string }) => {
    trackPlatformEvent('platform.folder.created', {
      'folder.id': attrs.folderId,
      'folder.name': attrs.name,
      'workspace.id': attrs.workspaceId,
    })
  },

  /**
   * Track folder deleted
   */
  folderDeleted: (attrs: { folderId: string; workspaceId: string }) => {
    trackPlatformEvent('platform.folder.deleted', {
      'folder.id': attrs.folderId,
      'workspace.id': attrs.workspaceId,
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
      'chat.id': attrs.chatId,
      'workflow.id': attrs.workflowId,
      'chat.auth_type': attrs.authType,
      'chat.has_output_configs': attrs.hasOutputConfigs,
    })
  },
}
