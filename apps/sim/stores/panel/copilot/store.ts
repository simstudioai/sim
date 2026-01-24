'use client'

import { createLogger } from '@sim/logger'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import type { CopilotTransportMode } from '@/lib/copilot/models'
import type {
  BaseClientToolMetadata,
  ClientToolDisplay,
} from '@/lib/copilot/tools/client/base-tool'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { GetBlockConfigClientTool } from '@/lib/copilot/tools/client/blocks/get-block-config'
import { GetBlockOptionsClientTool } from '@/lib/copilot/tools/client/blocks/get-block-options'
import { GetBlocksAndToolsClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-and-tools'
import { GetBlocksMetadataClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-metadata'
import { GetTriggerBlocksClientTool } from '@/lib/copilot/tools/client/blocks/get-trigger-blocks'
import { GetExamplesRagClientTool } from '@/lib/copilot/tools/client/examples/get-examples-rag'
import { GetOperationsExamplesClientTool } from '@/lib/copilot/tools/client/examples/get-operations-examples'
import { GetTriggerExamplesClientTool } from '@/lib/copilot/tools/client/examples/get-trigger-examples'
import { SummarizeClientTool } from '@/lib/copilot/tools/client/examples/summarize'
import { KnowledgeBaseClientTool } from '@/lib/copilot/tools/client/knowledge/knowledge-base'
import {
  getClientTool,
  registerClientTool,
  registerToolStateSync,
} from '@/lib/copilot/tools/client/manager'
import { NavigateUIClientTool } from '@/lib/copilot/tools/client/navigation/navigate-ui'
import { AuthClientTool } from '@/lib/copilot/tools/client/other/auth'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { CrawlWebsiteClientTool } from '@/lib/copilot/tools/client/other/crawl-website'
import { CustomToolClientTool } from '@/lib/copilot/tools/client/other/custom-tool'
import { DebugClientTool } from '@/lib/copilot/tools/client/other/debug'
import { DeployClientTool } from '@/lib/copilot/tools/client/other/deploy'
import { EditClientTool } from '@/lib/copilot/tools/client/other/edit'
import { EvaluateClientTool } from '@/lib/copilot/tools/client/other/evaluate'
import { GetPageContentsClientTool } from '@/lib/copilot/tools/client/other/get-page-contents'
import { InfoClientTool } from '@/lib/copilot/tools/client/other/info'
import { KnowledgeClientTool } from '@/lib/copilot/tools/client/other/knowledge'
import { MakeApiRequestClientTool } from '@/lib/copilot/tools/client/other/make-api-request'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { RememberDebugClientTool } from '@/lib/copilot/tools/client/other/remember-debug'
import { ResearchClientTool } from '@/lib/copilot/tools/client/other/research'
import { ScrapePageClientTool } from '@/lib/copilot/tools/client/other/scrape-page'
import { SearchDocumentationClientTool } from '@/lib/copilot/tools/client/other/search-documentation'
import { SearchErrorsClientTool } from '@/lib/copilot/tools/client/other/search-errors'
import { SearchLibraryDocsClientTool } from '@/lib/copilot/tools/client/other/search-library-docs'
import { SearchOnlineClientTool } from '@/lib/copilot/tools/client/other/search-online'
import { SearchPatternsClientTool } from '@/lib/copilot/tools/client/other/search-patterns'
import { SleepClientTool } from '@/lib/copilot/tools/client/other/sleep'
import { TestClientTool } from '@/lib/copilot/tools/client/other/test'
import { TourClientTool } from '@/lib/copilot/tools/client/other/tour'
import { WorkflowClientTool } from '@/lib/copilot/tools/client/other/workflow'
import { createExecutionContext, getTool } from '@/lib/copilot/tools/client/registry'
import { GetCredentialsClientTool } from '@/lib/copilot/tools/client/user/get-credentials'
import { SetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/set-environment-variables'
import { CheckDeploymentStatusClientTool } from '@/lib/copilot/tools/client/workflow/check-deployment-status'
import { CreateWorkspaceMcpServerClientTool } from '@/lib/copilot/tools/client/workflow/create-workspace-mcp-server'
import { DeployApiClientTool } from '@/lib/copilot/tools/client/workflow/deploy-api'
import { DeployChatClientTool } from '@/lib/copilot/tools/client/workflow/deploy-chat'
import { DeployMcpClientTool } from '@/lib/copilot/tools/client/workflow/deploy-mcp'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { GetBlockOutputsClientTool } from '@/lib/copilot/tools/client/workflow/get-block-outputs'
import { GetBlockUpstreamReferencesClientTool } from '@/lib/copilot/tools/client/workflow/get-block-upstream-references'
import { GetUserWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/get-user-workflow'
import { GetWorkflowConsoleClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-console'
import { GetWorkflowDataClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-data'
import { GetWorkflowFromNameClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-from-name'
import { ListUserWorkflowsClientTool } from '@/lib/copilot/tools/client/workflow/list-user-workflows'
import { ListWorkspaceMcpServersClientTool } from '@/lib/copilot/tools/client/workflow/list-workspace-mcp-servers'
import { ManageCustomToolClientTool } from '@/lib/copilot/tools/client/workflow/manage-custom-tool'
import { ManageMcpToolClientTool } from '@/lib/copilot/tools/client/workflow/manage-mcp-tool'
import { RedeployClientTool } from '@/lib/copilot/tools/client/workflow/redeploy'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { SetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-global-workflow-variables'
import { getQueryClient } from '@/app/_shell/providers/query-provider'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import type {
  ChatContext,
  CopilotMessage,
  CopilotStore,
  CopilotToolCall,
  MessageFileAttachment,
} from '@/stores/panel/copilot/types'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotStore')

// On module load, clear any lingering diff preview (fresh page refresh)
try {
  const diffStore = useWorkflowDiffStore.getState()
  if (diffStore?.hasActiveDiff) {
    diffStore.clearDiff()
  }
} catch {}

// Known class-based client tools: map tool name -> instantiator
const CLIENT_TOOL_INSTANTIATORS: Record<string, (id: string) => any> = {
  plan: (id) => new PlanClientTool(id),
  edit: (id) => new EditClientTool(id),
  debug: (id) => new DebugClientTool(id),
  test: (id) => new TestClientTool(id),
  deploy: (id) => new DeployClientTool(id),
  evaluate: (id) => new EvaluateClientTool(id),
  auth: (id) => new AuthClientTool(id),
  research: (id) => new ResearchClientTool(id),
  knowledge: (id) => new KnowledgeClientTool(id),
  custom_tool: (id) => new CustomToolClientTool(id),
  tour: (id) => new TourClientTool(id),
  info: (id) => new InfoClientTool(id),
  workflow: (id) => new WorkflowClientTool(id),
  run_workflow: (id) => new RunWorkflowClientTool(id),
  get_workflow_console: (id) => new GetWorkflowConsoleClientTool(id),
  get_blocks_and_tools: (id) => new GetBlocksAndToolsClientTool(id),
  get_blocks_metadata: (id) => new GetBlocksMetadataClientTool(id),
  get_block_options: (id) => new GetBlockOptionsClientTool(id),
  get_block_config: (id) => new GetBlockConfigClientTool(id),
  get_trigger_blocks: (id) => new GetTriggerBlocksClientTool(id),
  search_online: (id) => new SearchOnlineClientTool(id),
  search_documentation: (id) => new SearchDocumentationClientTool(id),
  search_library_docs: (id) => new SearchLibraryDocsClientTool(id),
  search_patterns: (id) => new SearchPatternsClientTool(id),
  search_errors: (id) => new SearchErrorsClientTool(id),
  scrape_page: (id) => new ScrapePageClientTool(id),
  get_page_contents: (id) => new GetPageContentsClientTool(id),
  crawl_website: (id) => new CrawlWebsiteClientTool(id),
  remember_debug: (id) => new RememberDebugClientTool(id),
  set_environment_variables: (id) => new SetEnvironmentVariablesClientTool(id),
  get_credentials: (id) => new GetCredentialsClientTool(id),
  knowledge_base: (id) => new KnowledgeBaseClientTool(id),
  make_api_request: (id) => new MakeApiRequestClientTool(id),
  checkoff_todo: (id) => new CheckoffTodoClientTool(id),
  mark_todo_in_progress: (id) => new MarkTodoInProgressClientTool(id),
  oauth_request_access: (id) => new OAuthRequestAccessClientTool(id),
  edit_workflow: (id) => new EditWorkflowClientTool(id),
  get_user_workflow: (id) => new GetUserWorkflowClientTool(id),
  list_user_workflows: (id) => new ListUserWorkflowsClientTool(id),
  get_workflow_from_name: (id) => new GetWorkflowFromNameClientTool(id),
  get_workflow_data: (id) => new GetWorkflowDataClientTool(id),
  set_global_workflow_variables: (id) => new SetGlobalWorkflowVariablesClientTool(id),
  get_trigger_examples: (id) => new GetTriggerExamplesClientTool(id),
  get_examples_rag: (id) => new GetExamplesRagClientTool(id),
  get_operations_examples: (id) => new GetOperationsExamplesClientTool(id),
  summarize_conversation: (id) => new SummarizeClientTool(id),
  deploy_api: (id) => new DeployApiClientTool(id),
  deploy_chat: (id) => new DeployChatClientTool(id),
  deploy_mcp: (id) => new DeployMcpClientTool(id),
  redeploy: (id) => new RedeployClientTool(id),
  list_workspace_mcp_servers: (id) => new ListWorkspaceMcpServersClientTool(id),
  create_workspace_mcp_server: (id) => new CreateWorkspaceMcpServerClientTool(id),
  check_deployment_status: (id) => new CheckDeploymentStatusClientTool(id),
  navigate_ui: (id) => new NavigateUIClientTool(id),
  manage_custom_tool: (id) => new ManageCustomToolClientTool(id),
  manage_mcp_tool: (id) => new ManageMcpToolClientTool(id),
  sleep: (id) => new SleepClientTool(id),
  get_block_outputs: (id) => new GetBlockOutputsClientTool(id),
  get_block_upstream_references: (id) => new GetBlockUpstreamReferencesClientTool(id),
}

// Read-only static metadata for class-based tools (no instances)
export const CLASS_TOOL_METADATA: Record<string, BaseClientToolMetadata | undefined> = {
  plan: (PlanClientTool as any)?.metadata,
  edit: (EditClientTool as any)?.metadata,
  debug: (DebugClientTool as any)?.metadata,
  test: (TestClientTool as any)?.metadata,
  deploy: (DeployClientTool as any)?.metadata,
  evaluate: (EvaluateClientTool as any)?.metadata,
  auth: (AuthClientTool as any)?.metadata,
  research: (ResearchClientTool as any)?.metadata,
  knowledge: (KnowledgeClientTool as any)?.metadata,
  custom_tool: (CustomToolClientTool as any)?.metadata,
  tour: (TourClientTool as any)?.metadata,
  info: (InfoClientTool as any)?.metadata,
  workflow: (WorkflowClientTool as any)?.metadata,
  run_workflow: (RunWorkflowClientTool as any)?.metadata,
  get_workflow_console: (GetWorkflowConsoleClientTool as any)?.metadata,
  get_blocks_and_tools: (GetBlocksAndToolsClientTool as any)?.metadata,
  get_blocks_metadata: (GetBlocksMetadataClientTool as any)?.metadata,
  get_block_options: (GetBlockOptionsClientTool as any)?.metadata,
  get_block_config: (GetBlockConfigClientTool as any)?.metadata,
  get_trigger_blocks: (GetTriggerBlocksClientTool as any)?.metadata,
  search_online: (SearchOnlineClientTool as any)?.metadata,
  search_documentation: (SearchDocumentationClientTool as any)?.metadata,
  search_library_docs: (SearchLibraryDocsClientTool as any)?.metadata,
  search_patterns: (SearchPatternsClientTool as any)?.metadata,
  search_errors: (SearchErrorsClientTool as any)?.metadata,
  scrape_page: (ScrapePageClientTool as any)?.metadata,
  get_page_contents: (GetPageContentsClientTool as any)?.metadata,
  crawl_website: (CrawlWebsiteClientTool as any)?.metadata,
  remember_debug: (RememberDebugClientTool as any)?.metadata,
  set_environment_variables: (SetEnvironmentVariablesClientTool as any)?.metadata,
  get_credentials: (GetCredentialsClientTool as any)?.metadata,
  knowledge_base: (KnowledgeBaseClientTool as any)?.metadata,
  make_api_request: (MakeApiRequestClientTool as any)?.metadata,
  checkoff_todo: (CheckoffTodoClientTool as any)?.metadata,
  mark_todo_in_progress: (MarkTodoInProgressClientTool as any)?.metadata,
  edit_workflow: (EditWorkflowClientTool as any)?.metadata,
  get_user_workflow: (GetUserWorkflowClientTool as any)?.metadata,
  list_user_workflows: (ListUserWorkflowsClientTool as any)?.metadata,
  get_workflow_from_name: (GetWorkflowFromNameClientTool as any)?.metadata,
  get_workflow_data: (GetWorkflowDataClientTool as any)?.metadata,
  set_global_workflow_variables: (SetGlobalWorkflowVariablesClientTool as any)?.metadata,
  get_trigger_examples: (GetTriggerExamplesClientTool as any)?.metadata,
  get_examples_rag: (GetExamplesRagClientTool as any)?.metadata,
  oauth_request_access: (OAuthRequestAccessClientTool as any)?.metadata,
  get_operations_examples: (GetOperationsExamplesClientTool as any)?.metadata,
  summarize_conversation: (SummarizeClientTool as any)?.metadata,
  deploy_api: (DeployApiClientTool as any)?.metadata,
  deploy_chat: (DeployChatClientTool as any)?.metadata,
  deploy_mcp: (DeployMcpClientTool as any)?.metadata,
  redeploy: (RedeployClientTool as any)?.metadata,
  list_workspace_mcp_servers: (ListWorkspaceMcpServersClientTool as any)?.metadata,
  create_workspace_mcp_server: (CreateWorkspaceMcpServerClientTool as any)?.metadata,
  check_deployment_status: (CheckDeploymentStatusClientTool as any)?.metadata,
  navigate_ui: (NavigateUIClientTool as any)?.metadata,
  manage_custom_tool: (ManageCustomToolClientTool as any)?.metadata,
  manage_mcp_tool: (ManageMcpToolClientTool as any)?.metadata,
  sleep: (SleepClientTool as any)?.metadata,
  get_block_outputs: (GetBlockOutputsClientTool as any)?.metadata,
  get_block_upstream_references: (GetBlockUpstreamReferencesClientTool as any)?.metadata,
}

function ensureClientToolInstance(toolName: string | undefined, toolCallId: string | undefined) {
  try {
    if (!toolName || !toolCallId) return
    if (getClientTool(toolCallId)) return
    const make = CLIENT_TOOL_INSTANTIATORS[toolName]
    if (make) {
      const inst = make(toolCallId)
      registerClientTool(toolCallId, inst)
    }
  } catch {}
}

// Constants
const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const DATA_PREFIX = 'data: '
const DATA_PREFIX_LENGTH = 6
const CONTINUE_OPTIONS_TAG = '<options>{"1":"Continue"}</options>'

// Resolve display text/icon for a tool based on its state
function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  try {
    if (!toolName) return undefined
    const def = getTool(toolName) as any
    const toolMetadata = def?.metadata || CLASS_TOOL_METADATA[toolName]
    const meta = toolMetadata?.displayNames || {}

    // Exact state first
    const ds = meta?.[state]
    if (ds?.text || ds?.icon) {
      // Check if tool has a dynamic text formatter
      const getDynamicText = toolMetadata?.getDynamicText
      if (getDynamicText && params) {
        try {
          const dynamicText = getDynamicText(params, state)
          if (dynamicText) {
            return { text: dynamicText, icon: ds.icon }
          }
        } catch (e) {
          // Fall back to static text if formatter fails
        }
      }
      return { text: ds.text, icon: ds.icon }
    }

    // Fallback order (prefer pre-execution states for unknown states like pending)
    const fallbackOrder: ClientToolCallState[] = [
      (ClientToolCallState as any).generating,
      (ClientToolCallState as any).executing,
      (ClientToolCallState as any).review,
      (ClientToolCallState as any).success,
      (ClientToolCallState as any).error,
      (ClientToolCallState as any).rejected,
    ]
    for (const key of fallbackOrder) {
      const cand = meta?.[key]
      if (cand?.text || cand?.icon) return { text: cand.text, icon: cand.icon }
    }
  } catch {}
  // Humanized fallback as last resort - include state verb for proper verb-noun styling
  try {
    if (toolName) {
      const formattedName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      // Add state verb prefix for verb-noun rendering in tool-call component
      let stateVerb: string
      switch (state) {
        case ClientToolCallState.pending:
        case ClientToolCallState.executing:
          stateVerb = 'Executing'
          break
        case ClientToolCallState.success:
          stateVerb = 'Executed'
          break
        case ClientToolCallState.error:
          stateVerb = 'Failed'
          break
        case ClientToolCallState.rejected:
        case ClientToolCallState.aborted:
          stateVerb = 'Skipped'
          break
        default:
          stateVerb = 'Executing'
      }
      return { text: `${stateVerb} ${formattedName}`, icon: undefined as any }
    }
  } catch {}
  return undefined
}

// Helper: check if a tool state is rejected
function isRejectedState(state: any): boolean {
  try {
    return state === 'rejected' || state === (ClientToolCallState as any).rejected
  } catch {
    return state === 'rejected'
  }
}

// Helper: check if a tool state is review (terminal for build/edit preview)
function isReviewState(state: any): boolean {
  try {
    return state === 'review' || state === (ClientToolCallState as any).review
  } catch {
    return state === 'review'
  }
}

// Helper: check if a tool state is background (terminal)
function isBackgroundState(state: any): boolean {
  try {
    return state === 'background' || state === (ClientToolCallState as any).background
  } catch {
    return state === 'background'
  }
}

/**
 * Checks if a tool call state is terminal (success, error, rejected, aborted, review, or background)
 */
function isTerminalState(state: any): boolean {
  return (
    state === ClientToolCallState.success ||
    state === ClientToolCallState.error ||
    state === ClientToolCallState.rejected ||
    state === ClientToolCallState.aborted ||
    isReviewState(state) ||
    isBackgroundState(state)
  )
}

// Helper: abort all in-progress client tools and update inline blocks
function abortAllInProgressTools(set: any, get: () => CopilotStore) {
  try {
    const { toolCallsById, messages } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds = new Set<string>()
    let hasUpdates = false
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state as any
      // Abort anything not already terminal success/error/rejected/aborted
      const isTerminal =
        st === ClientToolCallState.success ||
        st === ClientToolCallState.error ||
        st === ClientToolCallState.rejected ||
        st === ClientToolCallState.aborted
      if (!isTerminal || isReviewState(st)) {
        abortedIds.add(id)
        updatedMap[id] = {
          ...tc,
          state: ClientToolCallState.aborted,
          subAgentStreaming: false,
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, (tc as any).params),
        }
        hasUpdates = true
      } else if (tc.subAgentStreaming) {
        updatedMap[id] = {
          ...tc,
          subAgentStreaming: false,
        }
        hasUpdates = true
      }
    }
    if (abortedIds.size > 0 || hasUpdates) {
      set({ toolCallsById: updatedMap })
      // Update inline blocks in-place for the latest assistant message only (most relevant)
      set((s: CopilotStore) => {
        const msgs = [...s.messages]
        for (let mi = msgs.length - 1; mi >= 0; mi--) {
          const m = msgs[mi] as any
          if (m.role !== 'assistant' || !Array.isArray(m.contentBlocks)) continue
          let changed = false
          const blocks = m.contentBlocks.map((b: any) => {
            if (b?.type === 'tool_call' && b.toolCall?.id && abortedIds.has(b.toolCall.id)) {
              changed = true
              const prev = b.toolCall
              return {
                ...b,
                toolCall: {
                  ...prev,
                  state: ClientToolCallState.aborted,
                  display: resolveToolDisplay(
                    prev?.name,
                    ClientToolCallState.aborted,
                    prev?.id,
                    prev?.params
                  ),
                },
              }
            }
            return b
          })
          if (changed) {
            msgs[mi] = { ...m, contentBlocks: blocks }
            break
          }
        }
        return { messages: msgs }
      })
    }
  } catch {}
}

// Normalize loaded messages so assistant messages render correctly from DB
/**
 * Loads messages from DB for UI rendering.
 * Messages are stored exactly as they render, so we just need to:
 * 1. Register client tool instances for any tool calls
 * 2. Clear any streaming flags (messages loaded from DB are never actively streaming)
 * 3. Return the messages
 */
function normalizeMessagesForUI(messages: CopilotMessage[]): CopilotMessage[] {
  try {
    // Log what we're loading
    for (const message of messages) {
      if (message.role === 'assistant') {
        logger.info('[normalizeMessagesForUI] Loading assistant message', {
          id: message.id,
          hasContent: !!message.content?.trim(),
          contentBlockCount: message.contentBlocks?.length || 0,
          contentBlockTypes: (message.contentBlocks as any[])?.map((b) => b?.type) || [],
        })
      }
    }

    // Register client tool instances and clear streaming flags for all tool calls
    for (const message of messages) {
      if (message.contentBlocks) {
        for (const block of message.contentBlocks as any[]) {
          if (block?.type === 'tool_call' && block.toolCall) {
            registerToolCallInstances(block.toolCall)
            clearStreamingFlags(block.toolCall)
          }
        }
      }
      // Also clear from toolCalls array (legacy format)
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          clearStreamingFlags(toolCall)
        }
      }
    }
    return messages
  } catch {
    return messages
  }
}

/**
 * Recursively clears streaming flags from a tool call and its nested subagent tool calls.
 * This ensures messages loaded from DB don't appear to be streaming.
 */
function clearStreamingFlags(toolCall: any): void {
  if (!toolCall) return

  // Always set subAgentStreaming to false - messages loaded from DB are never streaming
  toolCall.subAgentStreaming = false

  // Clear nested subagent tool calls
  if (Array.isArray(toolCall.subAgentBlocks)) {
    for (const block of toolCall.subAgentBlocks) {
      if (block?.type === 'subagent_tool_call' && block.toolCall) {
        clearStreamingFlags(block.toolCall)
      }
    }
  }
  if (Array.isArray(toolCall.subAgentToolCalls)) {
    for (const subTc of toolCall.subAgentToolCalls) {
      clearStreamingFlags(subTc)
    }
  }
}

/**
 * Recursively registers client tool instances for a tool call and its nested subagent tool calls.
 */
function registerToolCallInstances(toolCall: any): void {
  if (!toolCall?.id) return
  ensureClientToolInstance(toolCall.name, toolCall.id)

  // Register nested subagent tool calls
  if (Array.isArray(toolCall.subAgentBlocks)) {
    for (const block of toolCall.subAgentBlocks) {
      if (block?.type === 'subagent_tool_call' && block.toolCall) {
        registerToolCallInstances(block.toolCall)
      }
    }
  }
  if (Array.isArray(toolCall.subAgentToolCalls)) {
    for (const subTc of toolCall.subAgentToolCalls) {
      registerToolCallInstances(subTc)
    }
  }
}

// Simple object pool for content blocks
class ObjectPool<T> {
  private pool: T[] = []
  private createFn: () => T
  private resetFn: (obj: T) => void

  constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize = 5) {
    this.createFn = createFn
    this.resetFn = resetFn
    for (let i = 0; i < initialSize; i++) this.pool.push(createFn())
  }
  get(): T {
    const obj = this.pool.pop()
    if (obj) {
      this.resetFn(obj)
      return obj
    }
    return this.createFn()
  }
  release(obj: T): void {
    if (this.pool.length < 20) this.pool.push(obj)
  }
}

const contentBlockPool = new ObjectPool(
  () => ({ type: '', content: '', timestamp: 0, toolCall: null as any }),
  (obj) => {
    obj.type = ''
    obj.content = ''
    obj.timestamp = 0
    ;(obj as any).toolCall = null
    ;(obj as any).startTime = undefined
    ;(obj as any).duration = undefined
  }
)

// Efficient string builder
class StringBuilder {
  private parts: string[] = []
  private length = 0
  append(str: string): void {
    this.parts.push(str)
    this.length += str.length
  }
  toString(): string {
    const result = this.parts.join('')
    this.clear()
    return result
  }
  clear(): void {
    this.parts.length = 0
    this.length = 0
  }
  get size(): number {
    return this.length
  }
}

// Helpers
function createUserMessage(
  content: string,
  fileAttachments?: MessageFileAttachment[],
  contexts?: ChatContext[],
  messageId?: string
): CopilotMessage {
  return {
    id: messageId || crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
    ...(contexts && contexts.length > 0 && { contexts }),
    ...(contexts &&
      contexts.length > 0 && {
        contentBlocks: [
          { type: 'contexts', contexts: contexts as any, timestamp: Date.now() },
        ] as any,
      }),
  }
}

function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

function createErrorMessage(
  messageId: string,
  content: string,
  errorType?: 'usage_limit' | 'unauthorized' | 'forbidden' | 'rate_limit' | 'upgrade_required'
): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text',
        content,
        timestamp: Date.now(),
      },
    ],
    errorType,
  }
}

/**
 * Builds a workflow snapshot suitable for checkpoint persistence.
 */
function buildCheckpointWorkflowState(workflowId: string): WorkflowState | null {
  const rawState = useWorkflowStore.getState().getWorkflowState()
  if (!rawState) return null

  const blocksWithSubblockValues = mergeSubblockState(rawState.blocks, workflowId)

  const filteredBlocks = Object.entries(blocksWithSubblockValues).reduce(
    (acc, [blockId, block]) => {
      if (block?.type && block?.name) {
        acc[blockId] = {
          ...block,
          id: block.id || blockId,
          enabled: block.enabled !== undefined ? block.enabled : true,
          horizontalHandles: block.horizontalHandles !== undefined ? block.horizontalHandles : true,
          height: block.height !== undefined ? block.height : 90,
          subBlocks: block.subBlocks || {},
          outputs: block.outputs || {},
          data: block.data || {},
          position: block.position || { x: 0, y: 0 },
        }
      }
      return acc
    },
    {} as WorkflowState['blocks']
  )

  return {
    blocks: filteredBlocks,
    edges: rawState.edges || [],
    loops: rawState.loops || {},
    parallels: rawState.parallels || {},
    lastSaved: rawState.lastSaved || Date.now(),
    deploymentStatuses: rawState.deploymentStatuses || {},
  }
}

/**
 * Persists a previously captured snapshot as a workflow checkpoint.
 */
async function saveMessageCheckpoint(
  messageId: string,
  get: () => CopilotStore,
  set: (partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)) => void
): Promise<boolean> {
  const { workflowId, currentChat, messageSnapshots, messageCheckpoints } = get()
  if (!workflowId || !currentChat?.id) return false

  const snapshot = messageSnapshots[messageId]
  if (!snapshot) return false

  const nextSnapshots = { ...messageSnapshots }
  delete nextSnapshots[messageId]
  set({ messageSnapshots: nextSnapshots })

  try {
    const response = await fetch('/api/copilot/checkpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        chatId: currentChat.id,
        messageId,
        workflowState: JSON.stringify(snapshot),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create checkpoint: ${response.statusText}`)
    }

    const result = await response.json()
    const newCheckpoint = result.checkpoint
    if (newCheckpoint) {
      const existingCheckpoints = messageCheckpoints[messageId] || []
      const updatedCheckpoints = {
        ...messageCheckpoints,
        [messageId]: [newCheckpoint, ...existingCheckpoints],
      }
      set({ messageCheckpoints: updatedCheckpoints })
    }

    return true
  } catch (error) {
    logger.error('Failed to create checkpoint from snapshot:', error)
    return false
  }
}

function stripTodoTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<marktodo>[\s\S]*?<\/marktodo>/g, '')
    .replace(/<checkofftodo>[\s\S]*?<\/checkofftodo>/g, '')
    .replace(/<design_workflow>[\s\S]*?<\/design_workflow>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
}

/**
 * Deep clones an object using JSON serialization.
 * This ensures we strip any non-serializable data (functions, circular refs).
 */
function deepClone<T>(obj: T): T {
  try {
    const json = JSON.stringify(obj)
    if (!json || json === 'undefined') {
      logger.warn('[deepClone] JSON.stringify returned empty for object', {
        type: typeof obj,
        isArray: Array.isArray(obj),
        length: Array.isArray(obj) ? obj.length : undefined,
      })
      return obj
    }
    const parsed = JSON.parse(json)
    // Verify the clone worked
    if (Array.isArray(obj) && (!Array.isArray(parsed) || parsed.length !== obj.length)) {
      logger.warn('[deepClone] Array clone mismatch', {
        originalLength: obj.length,
        clonedLength: Array.isArray(parsed) ? parsed.length : 'not array',
      })
    }
    return parsed
  } catch (err) {
    logger.error('[deepClone] Failed to clone object', {
      error: String(err),
      type: typeof obj,
      isArray: Array.isArray(obj),
    })
    return obj
  }
}

/**
 * Recursively masks credential IDs in any value (string, object, or array).
 * Used during serialization to ensure sensitive IDs are never persisted.
 */
function maskCredentialIdsInValue(value: any, credentialIds: Set<string>): any {
  if (!value || credentialIds.size === 0) return value

  if (typeof value === 'string') {
    let masked = value
    // Sort by length descending to mask longer IDs first
    const sortedIds = Array.from(credentialIds).sort((a, b) => b.length - a.length)
    for (const id of sortedIds) {
      if (id && masked.includes(id)) {
        masked = masked.split(id).join('••••••••')
      }
    }
    return masked
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskCredentialIdsInValue(item, credentialIds))
  }

  if (typeof value === 'object') {
    const masked: any = {}
    for (const key of Object.keys(value)) {
      masked[key] = maskCredentialIdsInValue(value[key], credentialIds)
    }
    return masked
  }

  return value
}

/**
 * Serializes messages for database storage.
 * Deep clones all fields to ensure proper JSON serialization.
 * Masks sensitive credential IDs before persisting.
 * This ensures they render identically when loaded back.
 */
function serializeMessagesForDB(messages: CopilotMessage[]): any[] {
  // Get credential IDs to mask
  const credentialIds = useCopilotStore.getState().sensitiveCredentialIds

  const result = messages
    .map((msg) => {
      // Deep clone the entire message to ensure all nested data is serializable
      // Ensure timestamp is always a string (Zod schema requires it)
      let timestamp: string = msg.timestamp
      if (typeof timestamp !== 'string') {
        const ts = timestamp as any
        timestamp = ts instanceof Date ? ts.toISOString() : new Date().toISOString()
      }

      const serialized: any = {
        id: msg.id,
        role: msg.role,
        content: msg.content || '',
        timestamp,
      }

      // Deep clone contentBlocks (the main rendering data)
      if (Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0) {
        serialized.contentBlocks = deepClone(msg.contentBlocks)
      }

      // Deep clone toolCalls
      if (Array.isArray((msg as any).toolCalls) && (msg as any).toolCalls.length > 0) {
        serialized.toolCalls = deepClone((msg as any).toolCalls)
      }

      // Deep clone file attachments
      if (Array.isArray(msg.fileAttachments) && msg.fileAttachments.length > 0) {
        serialized.fileAttachments = deepClone(msg.fileAttachments)
      }

      // Deep clone contexts
      if (Array.isArray((msg as any).contexts) && (msg as any).contexts.length > 0) {
        serialized.contexts = deepClone((msg as any).contexts)
      }

      // Deep clone citations
      if (Array.isArray(msg.citations) && msg.citations.length > 0) {
        serialized.citations = deepClone(msg.citations)
      }

      // Copy error type
      if (msg.errorType) {
        serialized.errorType = msg.errorType
      }

      // Mask credential IDs in the serialized message before persisting
      return maskCredentialIdsInValue(serialized, credentialIds)
    })
    .filter((msg) => {
      // Filter out empty assistant messages
      if (msg.role === 'assistant') {
        const hasContent = typeof msg.content === 'string' && msg.content.trim().length > 0
        const hasTools = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
        const hasBlocks = Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0
        return hasContent || hasTools || hasBlocks
      }
      return true
    })

  // Log what we're serializing
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      logger.info('[serializeMessagesForDB] Input assistant message', {
        id: msg.id,
        hasContent: !!msg.content?.trim(),
        contentBlockCount: msg.contentBlocks?.length || 0,
        contentBlockTypes: (msg.contentBlocks as any[])?.map((b) => b?.type) || [],
      })
    }
  }

  logger.info('[serializeMessagesForDB] Serialized messages', {
    inputCount: messages.length,
    outputCount: result.length,
    sample:
      result.length > 0
        ? {
            role: result[result.length - 1].role,
            hasContent: !!result[result.length - 1].content,
            contentBlockCount: result[result.length - 1].contentBlocks?.length || 0,
            toolCallCount: result[result.length - 1].toolCalls?.length || 0,
          }
        : null,
  })

  return result
}

/**
 * @deprecated Use serializeMessagesForDB instead.
 */
function validateMessagesForLLM(messages: CopilotMessage[]): any[] {
  return serializeMessagesForDB(messages)
}

/**
 * Extracts all tool calls from a toolCall object, including nested subAgentBlocks.
 * Adds them to the provided map.
 */
function extractToolCallsRecursively(
  toolCall: CopilotToolCall,
  map: Record<string, CopilotToolCall>
): void {
  if (!toolCall?.id) return
  map[toolCall.id] = toolCall

  // Extract nested tool calls from subAgentBlocks
  if (Array.isArray(toolCall.subAgentBlocks)) {
    for (const block of toolCall.subAgentBlocks) {
      if (block?.type === 'subagent_tool_call' && block.toolCall?.id) {
        extractToolCallsRecursively(block.toolCall, map)
      }
    }
  }

  // Extract from subAgentToolCalls as well
  if (Array.isArray(toolCall.subAgentToolCalls)) {
    for (const subTc of toolCall.subAgentToolCalls) {
      extractToolCallsRecursively(subTc, map)
    }
  }
}

/**
 * Builds a complete toolCallsById map from normalized messages.
 * Extracts all tool calls including nested subagent tool calls.
 */
function buildToolCallsById(messages: CopilotMessage[]): Record<string, CopilotToolCall> {
  const toolCallsById: Record<string, CopilotToolCall> = {}
  for (const msg of messages) {
    if (msg.contentBlocks) {
      for (const block of msg.contentBlocks as any[]) {
        if (block?.type === 'tool_call' && block.toolCall?.id) {
          extractToolCallsRecursively(block.toolCall, toolCallsById)
        }
      }
    }
  }
  return toolCallsById
}

// Streaming context and SSE parsing
interface StreamingContext {
  messageId: string
  accumulatedContent: StringBuilder
  contentBlocks: any[]
  currentTextBlock: any | null
  isInThinkingBlock: boolean
  currentThinkingBlock: any | null
  isInDesignWorkflowBlock: boolean
  designWorkflowContent: string
  pendingContent: string
  newChatId?: string
  doneEventCount: number
  streamComplete?: boolean
  wasAborted?: boolean
  suppressContinueOption?: boolean
  /** Track active subagent sessions by parent tool call ID */
  subAgentParentToolCallId?: string
  /** Track subagent content per parent tool call */
  subAgentContent: Record<string, string>
  /** Track subagent tool calls per parent tool call */
  subAgentToolCalls: Record<string, CopilotToolCall[]>
  /** Track subagent streaming blocks per parent tool call */
  subAgentBlocks: Record<string, any[]>
}

type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

function appendTextBlock(context: StreamingContext, text: string) {
  if (!text) return
  context.accumulatedContent.append(text)
  if (context.currentTextBlock && context.contentBlocks.length > 0) {
    const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
    if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
      lastBlock.content += text
      return
    }
  }
  context.currentTextBlock = contentBlockPool.get()
  context.currentTextBlock.type = TEXT_BLOCK_TYPE
  context.currentTextBlock.content = text
  context.currentTextBlock.timestamp = Date.now()
  context.contentBlocks.push(context.currentTextBlock)
}

function appendContinueOption(content: string): string {
  if (/<options>/i.test(content)) return content
  const suffix = content.trim().length > 0 ? '\n\n' : ''
  return `${content}${suffix}${CONTINUE_OPTIONS_TAG}`
}

function appendContinueOptionBlock(blocks: any[]): any[] {
  if (!Array.isArray(blocks)) return blocks
  const hasOptions = blocks.some(
    (block) =>
      block?.type === TEXT_BLOCK_TYPE &&
      typeof block.content === 'string' &&
      /<options>/i.test(block.content)
  )
  if (hasOptions) return blocks
  return [
    ...blocks,
    {
      type: TEXT_BLOCK_TYPE,
      content: CONTINUE_OPTIONS_TAG,
      timestamp: Date.now(),
    },
  ]
}

function beginThinkingBlock(context: StreamingContext) {
  if (!context.currentThinkingBlock) {
    context.currentThinkingBlock = contentBlockPool.get()
    context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
    context.currentThinkingBlock.content = ''
    context.currentThinkingBlock.timestamp = Date.now()
    ;(context.currentThinkingBlock as any).startTime = Date.now()
    context.contentBlocks.push(context.currentThinkingBlock)
  }
  context.isInThinkingBlock = true
  context.currentTextBlock = null
}

/**
 * Removes thinking tags (raw or escaped) from streamed content.
 */
function stripThinkingTags(text: string): string {
  return text.replace(/<\/?thinking[^>]*>/gi, '').replace(/&lt;\/?thinking[^&]*&gt;/gi, '')
}

function appendThinkingContent(context: StreamingContext, text: string) {
  if (!text) return
  const cleanedText = stripThinkingTags(text)
  if (!cleanedText) return
  if (context.currentThinkingBlock) {
    context.currentThinkingBlock.content += cleanedText
  } else {
    context.currentThinkingBlock = contentBlockPool.get()
    context.currentThinkingBlock.type = THINKING_BLOCK_TYPE
    context.currentThinkingBlock.content = cleanedText
    context.currentThinkingBlock.timestamp = Date.now()
    context.currentThinkingBlock.startTime = Date.now()
    context.contentBlocks.push(context.currentThinkingBlock)
  }
  context.isInThinkingBlock = true
  context.currentTextBlock = null
}

function finalizeThinkingBlock(context: StreamingContext) {
  if (context.currentThinkingBlock) {
    context.currentThinkingBlock.duration =
      Date.now() - (context.currentThinkingBlock.startTime || Date.now())
  }
  context.isInThinkingBlock = false
  context.currentThinkingBlock = null
  context.currentTextBlock = null
}

function upsertToolCallBlock(context: StreamingContext, toolCall: CopilotToolCall) {
  let found = false
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const b = context.contentBlocks[i] as any
    if (b.type === 'tool_call' && b.toolCall?.id === toolCall.id) {
      context.contentBlocks[i] = { ...b, toolCall }
      found = true
      break
    }
  }
  if (!found) {
    context.contentBlocks.push({ type: 'tool_call', toolCall, timestamp: Date.now() })
  }
}

function appendSubAgentText(context: StreamingContext, parentToolCallId: string, text: string) {
  if (!context.subAgentContent[parentToolCallId]) {
    context.subAgentContent[parentToolCallId] = ''
  }
  if (!context.subAgentBlocks[parentToolCallId]) {
    context.subAgentBlocks[parentToolCallId] = []
  }
  context.subAgentContent[parentToolCallId] += text
  const blocks = context.subAgentBlocks[parentToolCallId]
  const lastBlock = blocks[blocks.length - 1]
  if (lastBlock && lastBlock.type === 'subagent_text') {
    lastBlock.content = (lastBlock.content || '') + text
  } else {
    blocks.push({
      type: 'subagent_text',
      content: text,
      timestamp: Date.now(),
    })
  }
}

const sseHandlers: Record<string, SSEHandler> = {
  chat_id: async (data, context, get) => {
    context.newChatId = data.chatId
    const { currentChat } = get()
    if (!currentChat && context.newChatId) {
      await get().handleNewChatCreation(context.newChatId)
    }
  },
  title_updated: (_data, _context, get, set) => {
    const title = _data.title
    if (!title) return
    const { currentChat, chats } = get()
    if (currentChat) {
      set({
        currentChat: { ...currentChat, title },
        chats: chats.map((c) => (c.id === currentChat.id ? { ...c, title } : c)),
      })
    }
  },
  tool_result: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const skipped: boolean = data?.result?.skipped === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          // Preserve terminal review/rejected state; do not override
          return
        }
        const targetState = success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })

        // If checkoff_todo succeeded, mark todo as completed in planTodos
        if (targetState === ClientToolCallState.success && current.name === 'checkoff_todo') {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'completed')
            }
          } catch {}
        }

        // If mark_todo_in_progress succeeded, set todo executing in planTodos
        if (
          targetState === ClientToolCallState.success &&
          current.name === 'mark_todo_in_progress'
        ) {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'executing')
            }
          } catch {}
        }
      }

      // Update inline content block state
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = success
            ? ClientToolCallState.success
            : failedDependency || skipped
              ? ClientToolCallState.rejected
              : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch {}
  },
  tool_error: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const failedDependency: boolean = data?.failedDependency === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          return
        }
        const targetState = failedDependency
          ? ClientToolCallState.rejected
          : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })
      }
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = failedDependency
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)
    } catch {}
  },
  tool_generating: (data, context, get, set) => {
    const { toolCallId, toolName } = data
    if (!toolCallId || !toolName) return
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    ensureClientToolInstance(toolName, toolCallId)

    if (!toolCallsById[toolCallId]) {
      // Show as pending until we receive full tool_call (with arguments) to decide execution
      const initialState = ClientToolCallState.pending
      const tc: CopilotToolCall = {
        id: toolCallId,
        name: toolName,
        state: initialState,
        display: resolveToolDisplay(toolName, initialState, toolCallId),
      }
      const updated = { ...toolCallsById, [toolCallId]: tc }
      set({ toolCallsById: updated })
      logger.info('[toolCallsById] map updated', updated)

      // Add/refresh inline content block
      upsertToolCallBlock(context, tc)
      updateStreamingMessage(set, context)
    }
  },
  tool_call: (data, context, get, set) => {
    const toolData = data?.data || {}
    const id: string | undefined = toolData.id || data?.toolCallId
    const name: string | undefined = toolData.name || data?.toolName
    if (!id) return
    const args = toolData.arguments
    const isPartial = toolData.partial === true
    const { toolCallsById } = get()

    // Ensure class-based client tool instances are registered (for interrupts/display)
    ensureClientToolInstance(name, id)

    const existing = toolCallsById[id]
    const next: CopilotToolCall = existing
      ? {
          ...existing,
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
      : {
          id,
          name: name || 'unknown_tool',
          state: ClientToolCallState.pending,
          ...(args ? { params: args } : {}),
          display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
        }
    const updated = { ...toolCallsById, [id]: next }
    set({ toolCallsById: updated })
    logger.info('[toolCallsById] → pending', { id, name, params: args })

    // Ensure an inline content block exists/updated for this tool call
    upsertToolCallBlock(context, next)
    updateStreamingMessage(set, context)

    // Do not execute on partial tool_call frames
    if (isPartial) {
      return
    }

    // Prefer interface-based registry to determine interrupt and execute
    try {
      const def = name ? getTool(name) : undefined
      if (def) {
        const hasInterrupt =
          typeof def.hasInterrupt === 'function'
            ? !!def.hasInterrupt(args || {})
            : !!def.hasInterrupt
        // Check if tool is auto-allowed - if so, execute even if it has an interrupt
        const { autoAllowedTools } = get()
        const isAutoAllowed = name ? autoAllowedTools.includes(name) : false
        if ((!hasInterrupt || isAutoAllowed) && typeof def.execute === 'function') {
          if (isAutoAllowed && hasInterrupt) {
            logger.info('[toolCallsById] Auto-executing tool with interrupt (auto-allowed)', {
              id,
              name,
            })
          }
          const ctx = createExecutionContext({ toolCallId: id, toolName: name || 'unknown_tool' })
          // Defer executing transition by a tick to let pending render
          setTimeout(() => {
            // Guard against duplicate execution - check if already executing or terminal
            const currentState = get().toolCallsById[id]?.state
            if (currentState === ClientToolCallState.executing || isTerminalState(currentState)) {
              return
            }

            const executingMap = { ...get().toolCallsById }
            executingMap[id] = {
              ...executingMap[id],
              state: ClientToolCallState.executing,
              display: resolveToolDisplay(name, ClientToolCallState.executing, id, args),
            }
            set({ toolCallsById: executingMap })
            logger.info('[toolCallsById] pending → executing (registry)', { id, name })

            // Update inline content block to executing
            for (let i = 0; i < context.contentBlocks.length; i++) {
              const b = context.contentBlocks[i] as any
              if (b.type === 'tool_call' && b.toolCall?.id === id) {
                context.contentBlocks[i] = {
                  ...b,
                  toolCall: { ...b.toolCall, state: ClientToolCallState.executing },
                }
                break
              }
            }
            updateStreamingMessage(set, context)

            Promise.resolve()
              .then(async () => {
                const result = await def.execute(ctx, args || {})
                const success =
                  result && typeof result.status === 'number'
                    ? result.status >= 200 && result.status < 300
                    : true
                const completeMap = { ...get().toolCallsById }
                // Do not override terminal review/rejected
                if (
                  isRejectedState(completeMap[id]?.state) ||
                  isReviewState(completeMap[id]?.state) ||
                  isBackgroundState(completeMap[id]?.state)
                ) {
                  return
                }
                completeMap[id] = {
                  ...completeMap[id],
                  state: success ? ClientToolCallState.success : ClientToolCallState.error,
                  display: resolveToolDisplay(
                    name,
                    success ? ClientToolCallState.success : ClientToolCallState.error,
                    id,
                    args
                  ),
                }
                set({ toolCallsById: completeMap })
                logger.info(
                  `[toolCallsById] executing → ${success ? 'success' : 'error'} (registry)`,
                  { id, name }
                )

                // Notify backend tool mark-complete endpoint
                try {
                  await fetch('/api/copilot/tools/mark-complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id,
                      name: name || 'unknown_tool',
                      status:
                        typeof result?.status === 'number' ? result.status : success ? 200 : 500,
                      message: result?.message,
                      data: result?.data,
                    }),
                  })
                } catch {}
              })
              .catch((e) => {
                const errorMap = { ...get().toolCallsById }
                // Do not override terminal review/rejected
                if (
                  isRejectedState(errorMap[id]?.state) ||
                  isReviewState(errorMap[id]?.state) ||
                  isBackgroundState(errorMap[id]?.state)
                ) {
                  return
                }
                errorMap[id] = {
                  ...errorMap[id],
                  state: ClientToolCallState.error,
                  display: resolveToolDisplay(name, ClientToolCallState.error, id, args),
                }
                set({ toolCallsById: errorMap })
                logger.error('Registry auto-execute tool failed', { id, name, error: e })
              })
          }, 0)
          return
        }
      }
    } catch (e) {
      logger.warn('tool_call registry auto-exec check failed', { id, name, error: e })
    }

    // Class-based auto-exec for non-interrupt tools or auto-allowed tools
    try {
      const inst = getClientTool(id) as any
      const hasInterrupt = !!inst?.getInterruptDisplays?.()
      // Check if tool is auto-allowed - if so, execute even if it has an interrupt
      const { autoAllowedTools: classAutoAllowed } = get()
      const isClassAutoAllowed = name ? classAutoAllowed.includes(name) : false
      if (
        (!hasInterrupt || isClassAutoAllowed) &&
        (typeof inst?.execute === 'function' || typeof inst?.handleAccept === 'function')
      ) {
        if (isClassAutoAllowed && hasInterrupt) {
          logger.info('[toolCallsById] Auto-executing class tool with interrupt (auto-allowed)', {
            id,
            name,
          })
        }
        setTimeout(() => {
          // Guard against duplicate execution - check if already executing or terminal
          const currentState = get().toolCallsById[id]?.state
          if (currentState === ClientToolCallState.executing || isTerminalState(currentState)) {
            return
          }

          const executingMap = { ...get().toolCallsById }
          executingMap[id] = {
            ...executingMap[id],
            state: ClientToolCallState.executing,
            display: resolveToolDisplay(name, ClientToolCallState.executing, id, args),
          }
          set({ toolCallsById: executingMap })
          logger.info('[toolCallsById] pending → executing (class)', { id, name })

          Promise.resolve()
            .then(async () => {
              // Use handleAccept for tools with interrupts, execute for others
              if (hasInterrupt && typeof inst?.handleAccept === 'function') {
                await inst.handleAccept(args || {})
              } else {
                await inst.execute(args || {})
              }
              // Success/error will be synced via registerToolStateSync
            })
            .catch(() => {
              const errorMap = { ...get().toolCallsById }
              // Do not override terminal review/rejected
              if (
                isRejectedState(errorMap[id]?.state) ||
                isReviewState(errorMap[id]?.state) ||
                isBackgroundState(errorMap[id]?.state)
              ) {
                return
              }
              errorMap[id] = {
                ...errorMap[id],
                state: ClientToolCallState.error,
                display: resolveToolDisplay(name, ClientToolCallState.error, id, args),
              }
              set({ toolCallsById: errorMap })
            })
        }, 0)
        return
      }
    } catch {}

    // Integration tools: Check auto-allowed or stay in pending state until user confirms
    // This handles tools like google_calendar_*, exa_*, gmail_read, etc. that aren't in the client registry
    // Only relevant if mode is 'build' (agent)
    const { mode, workflowId, autoAllowedTools, executeIntegrationTool } = get()
    if (mode === 'build' && workflowId) {
      // Check if tool was NOT found in client registry
      const def = name ? getTool(name) : undefined
      const inst = getClientTool(id) as any
      if (!def && !inst && name) {
        // Check if this integration tool is auto-allowed - if so, execute it immediately
        if (autoAllowedTools.includes(name)) {
          logger.info('[build mode] Auto-executing integration tool (auto-allowed)', { id, name })
          // Defer to allow pending state to render briefly
          setTimeout(() => {
            executeIntegrationTool(id).catch((err) => {
              logger.error('[build mode] Auto-execute integration tool failed', {
                id,
                name,
                error: err,
              })
            })
          }, 0)
        } else {
          // Integration tools stay in pending state until user confirms
          logger.info('[build mode] Integration tool awaiting user confirmation', {
            id,
            name,
          })
        }
      }
    }
  },
  reasoning: (data, context, _get, set) => {
    const phase = (data && (data.phase || data?.data?.phase)) as string | undefined
    if (phase === 'start') {
      beginThinkingBlock(context)
      updateStreamingMessage(set, context)
      return
    }
    if (phase === 'end') {
      finalizeThinkingBlock(context)
      updateStreamingMessage(set, context)
      return
    }
    const chunk: string = typeof data?.data === 'string' ? data.data : data?.content || ''
    if (!chunk) return
    appendThinkingContent(context, chunk)
    updateStreamingMessage(set, context)
  },
  content: (data, context, get, set) => {
    if (!data.data) return
    context.pendingContent += data.data

    let contentToProcess = context.pendingContent
    let hasProcessedContent = false

    const thinkingStartRegex = /<thinking>/
    const thinkingEndRegex = /<\/thinking>/
    const designWorkflowStartRegex = /<design_workflow>/
    const designWorkflowEndRegex = /<\/design_workflow>/

    const splitTrailingPartialTag = (
      text: string,
      tags: string[]
    ): { text: string; remaining: string } => {
      const partialIndex = text.lastIndexOf('<')
      if (partialIndex < 0) {
        return { text, remaining: '' }
      }
      const possibleTag = text.substring(partialIndex)
      const matchesTagStart = tags.some((tag) => tag.startsWith(possibleTag))
      if (!matchesTagStart) {
        return { text, remaining: '' }
      }
      return {
        text: text.substring(0, partialIndex),
        remaining: possibleTag,
      }
    }

    while (contentToProcess.length > 0) {
      // Handle design_workflow tags (takes priority over other content processing)
      if (context.isInDesignWorkflowBlock) {
        const endMatch = designWorkflowEndRegex.exec(contentToProcess)
        if (endMatch) {
          const designContent = contentToProcess.substring(0, endMatch.index)
          context.designWorkflowContent += designContent
          context.isInDesignWorkflowBlock = false

          // Update store with complete design workflow content (available in all modes)
          logger.info('[design_workflow] Tag complete, setting plan content', {
            contentLength: context.designWorkflowContent.length,
          })
          set({ streamingPlanContent: context.designWorkflowContent })

          contentToProcess = contentToProcess.substring(endMatch.index + endMatch[0].length)
          hasProcessedContent = true
        } else {
          // Still in design_workflow block, accumulate content
          const { text, remaining } = splitTrailingPartialTag(contentToProcess, [
            '</design_workflow>',
          ])
          context.designWorkflowContent += text

          // Update store with partial content for streaming effect (available in all modes)
          set({ streamingPlanContent: context.designWorkflowContent })

          contentToProcess = remaining
          hasProcessedContent = true
          if (remaining) {
            break
          }
        }
        continue
      }

      if (!context.isInThinkingBlock && !context.isInDesignWorkflowBlock) {
        // Check for design_workflow start tag first
        const designStartMatch = designWorkflowStartRegex.exec(contentToProcess)
        if (designStartMatch) {
          const textBeforeDesign = contentToProcess.substring(0, designStartMatch.index)
          if (textBeforeDesign) {
            appendTextBlock(context, textBeforeDesign)
            hasProcessedContent = true
          }
          context.isInDesignWorkflowBlock = true
          context.designWorkflowContent = ''
          contentToProcess = contentToProcess.substring(
            designStartMatch.index + designStartMatch[0].length
          )
          hasProcessedContent = true
          continue
        }

        const nextMarkIndex = contentToProcess.indexOf('<marktodo>')
        const nextCheckIndex = contentToProcess.indexOf('<checkofftodo>')
        const hasMark = nextMarkIndex >= 0
        const hasCheck = nextCheckIndex >= 0

        const nextTagIndex =
          hasMark && hasCheck
            ? Math.min(nextMarkIndex, nextCheckIndex)
            : hasMark
              ? nextMarkIndex
              : hasCheck
                ? nextCheckIndex
                : -1

        if (nextTagIndex >= 0) {
          const isMarkTodo = hasMark && nextMarkIndex === nextTagIndex
          const tagStart = isMarkTodo ? '<marktodo>' : '<checkofftodo>'
          const tagEnd = isMarkTodo ? '</marktodo>' : '</checkofftodo>'
          const closingIndex = contentToProcess.indexOf(tagEnd, nextTagIndex + tagStart.length)

          if (closingIndex === -1) {
            // Partial tag; wait for additional content
            break
          }

          const todoId = contentToProcess
            .substring(nextTagIndex + tagStart.length, closingIndex)
            .trim()
          logger.info(
            isMarkTodo ? '[TODO] Detected marktodo tag' : '[TODO] Detected checkofftodo tag',
            { todoId }
          )

          if (todoId) {
            try {
              get().updatePlanTodoStatus(todoId, isMarkTodo ? 'executing' : 'completed')
              logger.info(
                isMarkTodo
                  ? '[TODO] Successfully marked todo in progress'
                  : '[TODO] Successfully checked off todo',
                { todoId }
              )
            } catch (e) {
              logger.error(
                isMarkTodo
                  ? '[TODO] Failed to mark todo in progress'
                  : '[TODO] Failed to checkoff todo',
                { todoId, error: e }
              )
            }
          } else {
            logger.warn('[TODO] Empty todoId extracted from todo tag', { tagType: tagStart })
          }

          // Remove the tag AND newlines around it, but preserve ONE newline if both sides had them
          let beforeTag = contentToProcess.substring(0, nextTagIndex)
          let afterTag = contentToProcess.substring(closingIndex + tagEnd.length)

          const hadNewlineBefore = /(\r?\n)+$/.test(beforeTag)
          const hadNewlineAfter = /^(\r?\n)+/.test(afterTag)

          // Strip trailing newlines before the tag
          beforeTag = beforeTag.replace(/(\r?\n)+$/, '')
          // Strip leading newlines after the tag
          afterTag = afterTag.replace(/^(\r?\n)+/, '')

          // If there were newlines on both sides, add back ONE to preserve paragraph breaks
          contentToProcess =
            beforeTag + (hadNewlineBefore && hadNewlineAfter ? '\n' : '') + afterTag
          context.currentTextBlock = null
          hasProcessedContent = true
          continue
        }
      }

      if (context.isInThinkingBlock) {
        const endMatch = thinkingEndRegex.exec(contentToProcess)
        if (endMatch) {
          const thinkingContent = contentToProcess.substring(0, endMatch.index)
          appendThinkingContent(context, thinkingContent)
          finalizeThinkingBlock(context)
          contentToProcess = contentToProcess.substring(endMatch.index + endMatch[0].length)
          hasProcessedContent = true
        } else {
          const { text, remaining } = splitTrailingPartialTag(contentToProcess, ['</thinking>'])
          if (text) {
            appendThinkingContent(context, text)
            hasProcessedContent = true
          }
          contentToProcess = remaining
          if (remaining) {
            break
          }
        }
      } else {
        const startMatch = thinkingStartRegex.exec(contentToProcess)
        if (startMatch) {
          const textBeforeThinking = contentToProcess.substring(0, startMatch.index)
          if (textBeforeThinking) {
            appendTextBlock(context, textBeforeThinking)
            hasProcessedContent = true
          }
          context.isInThinkingBlock = true
          context.currentTextBlock = null
          contentToProcess = contentToProcess.substring(startMatch.index + startMatch[0].length)
          hasProcessedContent = true
        } else {
          // Check if content might contain partial todo tags and hold them back
          let partialTagIndex = contentToProcess.lastIndexOf('<')

          // Also check for partial marktodo or checkofftodo tags
          const partialMarkTodo = contentToProcess.lastIndexOf('<marktodo')
          const partialCheckoffTodo = contentToProcess.lastIndexOf('<checkofftodo')

          if (partialMarkTodo > partialTagIndex) {
            partialTagIndex = partialMarkTodo
          }
          if (partialCheckoffTodo > partialTagIndex) {
            partialTagIndex = partialCheckoffTodo
          }

          let textToAdd = contentToProcess
          let remaining = ''
          if (partialTagIndex >= 0 && partialTagIndex > contentToProcess.length - 50) {
            textToAdd = contentToProcess.substring(0, partialTagIndex)
            remaining = contentToProcess.substring(partialTagIndex)
          }
          if (textToAdd) {
            appendTextBlock(context, textToAdd)
            hasProcessedContent = true
          }
          contentToProcess = remaining
          break
        }
      }
    }

    context.pendingContent = contentToProcess
    if (hasProcessedContent) {
      updateStreamingMessage(set, context)
    }
  },
  done: (_data, context) => {
    logger.info('[SSE] DONE EVENT RECEIVED', {
      doneEventCount: context.doneEventCount,
      data: _data,
    })
    context.doneEventCount++
    if (context.doneEventCount >= 1) {
      logger.info('[SSE] Setting streamComplete = true, stream will terminate')
      context.streamComplete = true
    }
  },
  error: (data, context, _get, set) => {
    logger.error('Stream error:', data.error)
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg) =>
        msg.id === context.messageId
          ? {
              ...msg,
              content: context.accumulatedContent || 'An error occurred.',
              error: data.error,
            }
          : msg
      ),
    }))
    context.streamComplete = true
  },
  stream_end: (_data, context, _get, set) => {
    if (context.pendingContent) {
      if (context.isInThinkingBlock && context.currentThinkingBlock) {
        appendThinkingContent(context, context.pendingContent)
      } else if (context.pendingContent.trim()) {
        appendTextBlock(context, context.pendingContent)
      }
      context.pendingContent = ''
    }
    finalizeThinkingBlock(context)
    updateStreamingMessage(set, context)
  },
  default: () => {},
}

/**
 * Helper to update a tool call with subagent data in both toolCallsById and contentBlocks
 */
function updateToolCallWithSubAgentData(
  context: StreamingContext,
  get: () => CopilotStore,
  set: any,
  parentToolCallId: string
) {
  const { toolCallsById } = get()
  const parentToolCall = toolCallsById[parentToolCallId]
  if (!parentToolCall) {
    logger.warn('[SubAgent] updateToolCallWithSubAgentData: parent tool call not found', {
      parentToolCallId,
      availableToolCallIds: Object.keys(toolCallsById),
    })
    return
  }

  // Prepare subagent blocks array for ordered display
  const blocks = context.subAgentBlocks[parentToolCallId] || []

  const updatedToolCall: CopilotToolCall = {
    ...parentToolCall,
    subAgentContent: context.subAgentContent[parentToolCallId] || '',
    subAgentToolCalls: context.subAgentToolCalls[parentToolCallId] || [],
    subAgentBlocks: blocks,
    subAgentStreaming: true,
  }

  logger.info('[SubAgent] Updating tool call with subagent data', {
    parentToolCallId,
    parentToolName: parentToolCall.name,
    subAgentContentLength: updatedToolCall.subAgentContent?.length,
    subAgentBlocksCount: updatedToolCall.subAgentBlocks?.length,
    subAgentToolCallsCount: updatedToolCall.subAgentToolCalls?.length,
  })

  // Update in toolCallsById
  const updatedMap = { ...toolCallsById, [parentToolCallId]: updatedToolCall }
  set({ toolCallsById: updatedMap })

  // Update in contentBlocks
  let foundInContentBlocks = false
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const b = context.contentBlocks[i] as any
    if (b.type === 'tool_call' && b.toolCall?.id === parentToolCallId) {
      context.contentBlocks[i] = { ...b, toolCall: updatedToolCall }
      foundInContentBlocks = true
      break
    }
  }

  if (!foundInContentBlocks) {
    logger.warn('[SubAgent] Parent tool call not found in contentBlocks', {
      parentToolCallId,
      contentBlocksCount: context.contentBlocks.length,
      toolCallBlockIds: context.contentBlocks
        .filter((b: any) => b.type === 'tool_call')
        .map((b: any) => b.toolCall?.id),
    })
  }

  updateStreamingMessage(set, context)
}

/**
 * SSE handlers for subagent events (events with subagent field set)
 * These handle content and tool calls from subagents like debug
 */
const subAgentSSEHandlers: Record<string, SSEHandler> = {
  // Handle subagent response start (ignore - just a marker)
  start: () => {
    // Subagent start event - no action needed, parent is already tracked from subagent_start
  },

  // Handle subagent text content (reasoning/thinking)
  content: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    logger.info('[SubAgent] content event', {
      parentToolCallId,
      hasData: !!data.data,
      dataPreview: typeof data.data === 'string' ? data.data.substring(0, 50) : null,
    })
    if (!parentToolCallId || !data.data) {
      logger.warn('[SubAgent] content missing parentToolCallId or data', {
        parentToolCallId,
        hasData: !!data.data,
      })
      return
    }

    appendSubAgentText(context, parentToolCallId, data.data)

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },

  // Handle subagent reasoning (same as content for subagent display purposes)
  reasoning: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    const phase = data?.phase || data?.data?.phase
    if (!parentToolCallId) return

    // For reasoning, we just append the content (treating start/end as markers)
    if (phase === 'start' || phase === 'end') return

    const chunk = typeof data?.data === 'string' ? data.data : data?.content || ''
    if (!chunk) return

    appendSubAgentText(context, parentToolCallId, chunk)

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },

  // Handle subagent tool_generating (tool is being generated)
  tool_generating: () => {
    // Tool generating event - no action needed, we'll handle the actual tool_call
  },

  // Handle subagent tool calls - also execute client tools
  tool_call: async (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return

    const toolData = data?.data || {}
    const id: string | undefined = toolData.id || data?.toolCallId
    const name: string | undefined = toolData.name || data?.toolName
    if (!id || !name) return
    const isPartial = toolData.partial === true

    // Arguments can come in different locations depending on SSE format
    // Check multiple possible locations
    let args = toolData.arguments || toolData.input || data?.arguments || data?.input

    // If arguments is a string, try to parse it as JSON
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        logger.warn('[SubAgent] Failed to parse arguments string', { args })
      }
    }

    logger.info('[SubAgent] tool_call received', {
      id,
      name,
      hasArgs: !!args,
      argsKeys: args ? Object.keys(args) : [],
      toolDataKeys: Object.keys(toolData),
      dataKeys: Object.keys(data || {}),
    })

    // Initialize if needed
    if (!context.subAgentToolCalls[parentToolCallId]) {
      context.subAgentToolCalls[parentToolCallId] = []
    }
    if (!context.subAgentBlocks[parentToolCallId]) {
      context.subAgentBlocks[parentToolCallId] = []
    }

    // Ensure client tool instance is registered (for execution)
    ensureClientToolInstance(name, id)

    // Create or update the subagent tool call
    const existingIndex = context.subAgentToolCalls[parentToolCallId].findIndex(
      (tc) => tc.id === id
    )
    const subAgentToolCall: CopilotToolCall = {
      id,
      name,
      state: ClientToolCallState.pending,
      ...(args ? { params: args } : {}),
      display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
    }

    if (existingIndex >= 0) {
      context.subAgentToolCalls[parentToolCallId][existingIndex] = subAgentToolCall
    } else {
      context.subAgentToolCalls[parentToolCallId].push(subAgentToolCall)

      // Also add to ordered blocks
      context.subAgentBlocks[parentToolCallId].push({
        type: 'subagent_tool_call',
        toolCall: subAgentToolCall,
        timestamp: Date.now(),
      })
    }

    // Also add to main toolCallsById for proper tool execution
    const { toolCallsById } = get()
    const updated = { ...toolCallsById, [id]: subAgentToolCall }
    set({ toolCallsById: updated })

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)

    if (isPartial) {
      return
    }

    // Execute client tools in parallel (non-blocking) - same pattern as main tool_call handler
    // Check if tool is auto-allowed
    const { autoAllowedTools: subAgentAutoAllowed } = get()
    const isSubAgentAutoAllowed = name ? subAgentAutoAllowed.includes(name) : false

    try {
      const def = getTool(name)
      if (def) {
        const hasInterrupt =
          typeof def.hasInterrupt === 'function'
            ? !!def.hasInterrupt(args || {})
            : !!def.hasInterrupt
        // Auto-execute if no interrupt OR if auto-allowed
        if (!hasInterrupt || isSubAgentAutoAllowed) {
          if (isSubAgentAutoAllowed && hasInterrupt) {
            logger.info('[SubAgent] Auto-executing tool with interrupt (auto-allowed)', {
              id,
              name,
            })
          }
          // Auto-execute tools - non-blocking
          const ctx = createExecutionContext({ toolCallId: id, toolName: name })
          Promise.resolve()
            .then(() => def.execute(ctx, args || {}))
            .catch((execErr: any) => {
              logger.error('[SubAgent] Tool execution failed', {
                id,
                name,
                error: execErr?.message,
              })
            })
        }
      } else {
        // Fallback to class-based tools - non-blocking
        const instance = getClientTool(id)
        if (instance) {
          const hasInterruptDisplays = !!instance.getInterruptDisplays?.()
          // Auto-execute if no interrupt OR if auto-allowed
          if (!hasInterruptDisplays || isSubAgentAutoAllowed) {
            if (isSubAgentAutoAllowed && hasInterruptDisplays) {
              logger.info('[SubAgent] Auto-executing class tool with interrupt (auto-allowed)', {
                id,
                name,
              })
            }
            Promise.resolve()
              .then(() => {
                // Use handleAccept for tools with interrupts, execute for others
                if (hasInterruptDisplays && typeof instance.handleAccept === 'function') {
                  return instance.handleAccept(args || {})
                }
                return instance.execute(args || {})
              })
              .catch((execErr: any) => {
                logger.error('[SubAgent] Class tool execution failed', {
                  id,
                  name,
                  error: execErr?.message,
                })
              })
          }
        } else {
          // Check if this is an integration tool (server-side) that should be auto-executed
          const isIntegrationTool = !CLASS_TOOL_METADATA[name]
          if (isIntegrationTool && isSubAgentAutoAllowed) {
            logger.info('[SubAgent] Auto-executing integration tool (auto-allowed)', {
              id,
              name,
            })
            // Execute integration tool via the store method
            const { executeIntegrationTool } = get()
            executeIntegrationTool(id).catch((err) => {
              logger.error('[SubAgent] Integration tool auto-execution failed', {
                id,
                name,
                error: err?.message || err,
              })
            })
          }
        }
      }
    } catch (e: any) {
      logger.error('[SubAgent] Tool registry/execution error', { id, name, error: e?.message })
    }
  },

  // Handle subagent tool results
  tool_result: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return

    const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
    const success: boolean | undefined = data?.success !== false // Default to true if not specified
    if (!toolCallId) return

    // Initialize if needed
    if (!context.subAgentToolCalls[parentToolCallId]) return
    if (!context.subAgentBlocks[parentToolCallId]) return

    // Update the subagent tool call state
    const targetState = success ? ClientToolCallState.success : ClientToolCallState.error
    const existingIndex = context.subAgentToolCalls[parentToolCallId].findIndex(
      (tc) => tc.id === toolCallId
    )

    if (existingIndex >= 0) {
      const existing = context.subAgentToolCalls[parentToolCallId][existingIndex]
      const updatedSubAgentToolCall = {
        ...existing,
        state: targetState,
        display: resolveToolDisplay(existing.name, targetState, toolCallId, existing.params),
      }
      context.subAgentToolCalls[parentToolCallId][existingIndex] = updatedSubAgentToolCall

      // Also update in ordered blocks
      for (const block of context.subAgentBlocks[parentToolCallId]) {
        if (block.type === 'subagent_tool_call' && block.toolCall?.id === toolCallId) {
          block.toolCall = updatedSubAgentToolCall
          break
        }
      }

      // Update the individual tool call in toolCallsById so ToolCall component gets latest state
      const { toolCallsById } = get()
      if (toolCallsById[toolCallId]) {
        const updatedMap = {
          ...toolCallsById,
          [toolCallId]: updatedSubAgentToolCall,
        }
        set({ toolCallsById: updatedMap })
        logger.info('[SubAgent] Updated subagent tool call state in toolCallsById', {
          toolCallId,
          name: existing.name,
          state: targetState,
        })
      }
    }

    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },

  // Handle subagent stream done - just update the streaming state
  done: (data, context, get, set) => {
    const parentToolCallId = context.subAgentParentToolCallId
    if (!parentToolCallId) return

    // Update the tool call with final content but keep streaming true until subagent_end
    updateToolCallWithSubAgentData(context, get, set, parentToolCallId)
  },
}

// Debounced UI update queue for smoother streaming
const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null
let lastBatchTime = 0
const MIN_BATCH_INTERVAL = 16
const MAX_BATCH_INTERVAL = 50
const MAX_QUEUE_SIZE = 5

function stopStreamingUpdates() {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  streamingUpdateQueue.clear()
}

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

function updateStreamingMessage(set: any, context: StreamingContext) {
  const now = performance.now()
  streamingUpdateQueue.set(context.messageId, context)
  const timeSinceLastBatch = now - lastBatchTime
  const shouldFlushImmediately =
    streamingUpdateQueue.size >= MAX_QUEUE_SIZE || timeSinceLastBatch > MAX_BATCH_INTERVAL

  if (streamingUpdateRAF === null) {
    const scheduleUpdate = () => {
      streamingUpdateRAF = requestAnimationFrame(() => {
        const updates = new Map(streamingUpdateQueue)
        streamingUpdateQueue.clear()
        streamingUpdateRAF = null
        lastBatchTime = performance.now()
        set((state: CopilotStore) => {
          if (updates.size === 0) return state
          const messages = state.messages
          const lastMessage = messages[messages.length - 1]
          const lastMessageUpdate = lastMessage ? updates.get(lastMessage.id) : null
          if (updates.size === 1 && lastMessageUpdate) {
            const newMessages = [...messages]
            newMessages[messages.length - 1] = {
              ...lastMessage,
              content: '',
              contentBlocks:
                lastMessageUpdate.contentBlocks.length > 0
                  ? createOptimizedContentBlocks(lastMessageUpdate.contentBlocks)
                  : [],
            }
            return { messages: newMessages }
          }
          return {
            messages: messages.map((msg) => {
              const update = updates.get(msg.id)
              if (update) {
                return {
                  ...msg,
                  content: '',
                  contentBlocks:
                    update.contentBlocks.length > 0
                      ? createOptimizedContentBlocks(update.contentBlocks)
                      : [],
                }
              }
              return msg
            }),
          }
        })
      })
    }
    if (shouldFlushImmediately) scheduleUpdate()
    else setTimeout(scheduleUpdate, Math.max(0, MIN_BATCH_INTERVAL - timeSinceLastBatch))
  }
}

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
) {
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk
    const lastNewlineIndex = buffer.lastIndexOf('\n')
    if (lastNewlineIndex !== -1) {
      const linesToProcess = buffer.substring(0, lastNewlineIndex)
      buffer = buffer.substring(lastNewlineIndex + 1)
      const lines = linesToProcess.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.length === 0) continue
        if (line.charCodeAt(0) === 100 && line.startsWith(DATA_PREFIX)) {
          try {
            const jsonStr = line.substring(DATA_PREFIX_LENGTH)
            yield JSON.parse(jsonStr)
          } catch (error) {
            logger.warn('Failed to parse SSE data:', error)
          }
        }
      }
    }
  }
}

// Initial state (subset required for UI/streaming)
const initialState = {
  mode: 'build' as const,
  selectedModel: 'claude-4.5-opus' as CopilotStore['selectedModel'],
  agentPrefetch: false,
  enabledModels: null as string[] | null, // Null means not loaded yet, empty array means all disabled
  isCollapsed: false,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotMessage[],
  checkpoints: [] as any[],
  messageCheckpoints: {} as Record<string, any[]>,
  messageSnapshots: {} as Record<string, WorkflowState>,
  isLoading: false,
  isLoadingChats: false,
  isLoadingCheckpoints: false,
  isSendingMessage: false,
  isSaving: false,
  isRevertingCheckpoint: false,
  isAborting: false,
  error: null as string | null,
  saveError: null as string | null,
  checkpointError: null as string | null,
  workflowId: null as string | null,
  abortController: null as AbortController | null,
  chatsLastLoadedAt: null as Date | null,
  chatsLoadedForWorkflow: null as string | null,
  revertState: null as { messageId: string; messageContent: string } | null,
  inputValue: '',
  planTodos: [] as Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>,
  showPlanTodos: false,
  streamingPlanContent: '',
  toolCallsById: {} as Record<string, CopilotToolCall>,
  suppressAutoSelect: false,
  autoAllowedTools: [] as string[],
  messageQueue: [] as import('./types').QueuedMessage[],
  suppressAbortContinueOption: false,
  sensitiveCredentialIds: new Set<string>(),
}

export const useCopilotStore = create<CopilotStore>()(
  devtools((set, get) => ({
    ...initialState,

    // Basic mode controls
    setMode: (mode) => set({ mode }),

    // Clear messages (don't clear streamingPlanContent - let it persist)
    clearMessages: () => set({ messages: [] }),

    // Workflow selection
    setWorkflowId: async (workflowId: string | null) => {
      const currentWorkflowId = get().workflowId
      if (currentWorkflowId === workflowId) return
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()

      // Abort all in-progress tools and clear any diff preview
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff({ restoreBaseline: false })
      } catch {}

      set({
        ...initialState,
        workflowId,
        mode: get().mode,
        selectedModel: get().selectedModel,
        agentPrefetch: get().agentPrefetch,
      })
    },

    // Chats (minimal implementation for visibility)
    validateCurrentChat: () => {
      const { currentChat, workflowId, chats } = get()
      if (!currentChat || !workflowId) return false
      const chatExists = chats.some((c) => c.id === currentChat.id)
      if (!chatExists) {
        set({ currentChat: null, messages: [] })
        return false
      }
      return true
    },

    selectChat: async (chat: CopilotChat) => {
      const { isSendingMessage, currentChat, workflowId } = get()
      if (!workflowId) {
        return
      }
      if (currentChat && currentChat.id !== chat.id && isSendingMessage) get().abortMessage()

      // Abort in-progress tools and clear diff when changing chats
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff({ restoreBaseline: false })
      } catch {}

      // Restore plan content and config (mode/model) from selected chat
      const planArtifact = chat.planArtifact || ''
      const chatConfig = chat.config || {}
      const chatMode = chatConfig.mode || get().mode
      const chatModel = chatConfig.model || get().selectedModel

      logger.info('[Chat] Restoring chat config', {
        chatId: chat.id,
        mode: chatMode,
        model: chatModel,
        hasPlanArtifact: !!planArtifact,
      })

      // Capture previous chat/messages for optimistic background save
      const previousChat = currentChat
      const previousMessages = get().messages
      const previousMode = get().mode
      const previousModel = get().selectedModel

      // Optimistically set selected chat and normalize messages for UI
      const normalizedMessages = normalizeMessagesForUI(chat.messages || [])
      const toolCallsById = buildToolCallsById(normalizedMessages)

      set({
        currentChat: chat,
        messages: normalizedMessages,
        toolCallsById,
        planTodos: [],
        showPlanTodos: false,
        streamingPlanContent: planArtifact,
        mode: chatMode,
        selectedModel: chatModel as CopilotStore['selectedModel'],
        suppressAutoSelect: false,
      })

      // Background-save the previous chat's latest messages, plan artifact, and config before switching (optimistic)
      try {
        if (previousChat && previousChat.id !== chat.id) {
          const dbMessages = validateMessagesForLLM(previousMessages)
          const previousPlanArtifact = get().streamingPlanContent
          fetch('/api/copilot/chat/update-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId: previousChat.id,
              messages: dbMessages,
              planArtifact: previousPlanArtifact || null,
              config: {
                mode: previousMode,
                model: previousModel,
              },
            }),
          }).catch(() => {})
        }
      } catch {}

      // Refresh selected chat from server to ensure we have latest messages/tool calls
      try {
        const response = await fetch(`/api/copilot/chat?workflowId=${workflowId}`)
        if (!response.ok) throw new Error(`Failed to fetch latest chat data: ${response.status}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.chats)) {
          const latestChat = data.chats.find((c: CopilotChat) => c.id === chat.id)
          if (latestChat) {
            const normalizedMessages = normalizeMessagesForUI(latestChat.messages || [])
            const toolCallsById = buildToolCallsById(normalizedMessages)

            set({
              currentChat: latestChat,
              messages: normalizedMessages,
              chats: (get().chats || []).map((c: CopilotChat) =>
                c.id === chat.id ? latestChat : c
              ),
              toolCallsById,
            })
            try {
              await get().loadMessageCheckpoints(latestChat.id)
            } catch {}
          }
        }
      } catch {}
    },

    createNewChat: async () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()

      // Abort in-progress tools and clear diff on new chat
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff({ restoreBaseline: false })
      } catch {}

      // Background-save the current chat before clearing (optimistic)
      try {
        const { currentChat, streamingPlanContent, mode, selectedModel } = get()
        if (currentChat) {
          const currentMessages = get().messages
          const dbMessages = validateMessagesForLLM(currentMessages)
          fetch('/api/copilot/chat/update-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId: currentChat.id,
              messages: dbMessages,
              planArtifact: streamingPlanContent || null,
              config: {
                mode,
                model: selectedModel,
              },
            }),
          }).catch(() => {})
        }
      } catch {}

      set({
        currentChat: null,
        messages: [],
        messageCheckpoints: {},
        planTodos: [],
        showPlanTodos: false,
        streamingPlanContent: '',
        suppressAutoSelect: true,
      })
    },

    deleteChat: async (chatId: string) => {
      try {
        // Call delete API
        const response = await fetch('/api/copilot/chat/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId }),
        })

        if (!response.ok) {
          throw new Error(`Failed to delete chat: ${response.status}`)
        }

        // Remove from local state
        set((state) => ({
          chats: state.chats.filter((c) => c.id !== chatId),
          // If deleted chat was current, clear it
          currentChat: state.currentChat?.id === chatId ? null : state.currentChat,
          messages: state.currentChat?.id === chatId ? [] : state.messages,
        }))

        logger.info('Chat deleted', { chatId })
      } catch (error) {
        logger.error('Failed to delete chat:', error)
        throw error
      }
    },

    areChatsFresh: (_workflowId: string) => false,

    loadChats: async (_forceRefresh = false) => {
      const { workflowId } = get()

      if (!workflowId) {
        set({ chats: [], isLoadingChats: false })
        return
      }

      // For now always fetch fresh
      set({ isLoadingChats: true })
      try {
        const url = `/api/copilot/chat?workflowId=${workflowId}`
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to fetch chats: ${response.status}`)
        }
        const data = await response.json()
        if (data.success && Array.isArray(data.chats)) {
          const now = new Date()
          set({
            chats: data.chats,
            isLoadingChats: false,
            chatsLastLoadedAt: now,
            chatsLoadedForWorkflow: workflowId,
          })

          if (data.chats.length > 0) {
            const { currentChat, isSendingMessage, suppressAutoSelect } = get()
            const currentChatStillExists =
              currentChat && data.chats.some((c: CopilotChat) => c.id === currentChat.id)

            if (currentChatStillExists) {
              const updatedCurrentChat = data.chats.find(
                (c: CopilotChat) => c.id === currentChat!.id
              )!
              if (isSendingMessage) {
                set({ currentChat: { ...updatedCurrentChat, messages: get().messages } })
              } else {
                const normalizedMessages = normalizeMessagesForUI(updatedCurrentChat.messages || [])

                // Restore plan artifact and config from refreshed chat
                const refreshedPlanArtifact = updatedCurrentChat.planArtifact || ''
                const refreshedConfig = updatedCurrentChat.config || {}
                const refreshedMode = refreshedConfig.mode || get().mode
                const refreshedModel = refreshedConfig.model || get().selectedModel
                const toolCallsById = buildToolCallsById(normalizedMessages)

                set({
                  currentChat: updatedCurrentChat,
                  messages: normalizedMessages,
                  toolCallsById,
                  streamingPlanContent: refreshedPlanArtifact,
                  mode: refreshedMode,
                  selectedModel: refreshedModel as CopilotStore['selectedModel'],
                })
              }
              try {
                await get().loadMessageCheckpoints(updatedCurrentChat.id)
              } catch {}
            } else if (!isSendingMessage && !suppressAutoSelect) {
              const mostRecentChat: CopilotChat = data.chats[0]
              const normalizedMessages = normalizeMessagesForUI(mostRecentChat.messages || [])

              // Restore plan artifact and config from most recent chat
              const planArtifact = mostRecentChat.planArtifact || ''
              const chatConfig = mostRecentChat.config || {}
              const chatMode = chatConfig.mode || get().mode
              const chatModel = chatConfig.model || get().selectedModel

              logger.info('[Chat] Auto-selecting most recent chat with config', {
                chatId: mostRecentChat.id,
                mode: chatMode,
                model: chatModel,
                hasPlanArtifact: !!planArtifact,
              })

              const toolCallsById = buildToolCallsById(normalizedMessages)

              set({
                currentChat: mostRecentChat,
                messages: normalizedMessages,
                toolCallsById,
                streamingPlanContent: planArtifact,
                mode: chatMode,
                selectedModel: chatModel as CopilotStore['selectedModel'],
              })
              try {
                await get().loadMessageCheckpoints(mostRecentChat.id)
              } catch {}
            }
          } else {
            set({ currentChat: null, messages: [] })
          }
        } else {
          throw new Error('Invalid response format')
        }
      } catch (error) {
        set({
          chats: [],
          isLoadingChats: false,
          chatsLoadedForWorkflow: workflowId,
          error: error instanceof Error ? error.message : 'Failed to load chats',
        })
      }
    },

    // Send a message (streaming only)
    sendMessage: async (message: string, options = {}) => {
      const {
        workflowId,
        currentChat,
        mode,
        revertState,
        isSendingMessage,
        abortController: activeAbortController,
      } = get()
      const {
        stream = true,
        fileAttachments,
        contexts,
        messageId,
        queueIfBusy = true,
      } = options as {
        stream?: boolean
        fileAttachments?: MessageFileAttachment[]
        contexts?: ChatContext[]
        messageId?: string
        queueIfBusy?: boolean
      }

      if (!workflowId) return

      // If already sending a message, queue this one instead unless bypassing queue
      if (isSendingMessage && !activeAbortController) {
        logger.warn('[Copilot] sendMessage: stale sending state detected, clearing', {
          originalMessageId: messageId,
        })
        set({ isSendingMessage: false })
      } else if (isSendingMessage && activeAbortController?.signal.aborted) {
        logger.warn('[Copilot] sendMessage: aborted controller detected, clearing', {
          originalMessageId: messageId,
        })
        set({ isSendingMessage: false, abortController: null })
      } else if (isSendingMessage) {
        if (queueIfBusy) {
          get().addToQueue(message, { fileAttachments, contexts, messageId })
          logger.info('[Copilot] Message queued (already sending)', {
            queueLength: get().messageQueue.length + 1,
            originalMessageId: messageId,
          })
          return
        }
        get().abortMessage({ suppressContinueOption: true })
      }

      const nextAbortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController: nextAbortController })

      const userMessage = createUserMessage(message, fileAttachments, contexts, messageId)
      const streamingMessage = createStreamingMessage()
      const snapshot = workflowId ? buildCheckpointWorkflowState(workflowId) : null
      if (snapshot) {
        set((state) => ({
          messageSnapshots: { ...state.messageSnapshots, [userMessage.id]: snapshot },
        }))
      }

      get()
        .loadSensitiveCredentialIds()
        .catch((err) => {
          logger.warn('[Copilot] Failed to load sensitive credential IDs', err)
        })
      get()
        .loadAutoAllowedTools()
        .catch((err) => {
          logger.warn('[Copilot] Failed to load auto-allowed tools', err)
        })

      let newMessages: CopilotMessage[]
      if (revertState) {
        const currentMessages = get().messages
        newMessages = [...currentMessages, userMessage, streamingMessage]
        set({ revertState: null, inputValue: '' })
      } else {
        const currentMessages = get().messages
        // If messageId is provided, check if it already exists (e.g., from edit flow)
        const existingIndex = messageId ? currentMessages.findIndex((m) => m.id === messageId) : -1
        if (existingIndex !== -1) {
          // Replace existing message instead of adding new one
          newMessages = [...currentMessages.slice(0, existingIndex), userMessage, streamingMessage]
        } else {
          // Add new messages normally
          newMessages = [...currentMessages, userMessage, streamingMessage]
        }
      }

      const isFirstMessage = get().messages.length === 0 && !currentChat?.title
      set((state) => ({
        messages: newMessages,
        currentUserMessageId: userMessage.id,
      }))

      if (isFirstMessage) {
        const optimisticTitle = message.length > 50 ? `${message.substring(0, 47)}...` : message
        set((state) => ({
          currentChat: state.currentChat
            ? { ...state.currentChat, title: optimisticTitle }
            : state.currentChat,
          chats: state.currentChat
            ? state.chats.map((c) =>
                c.id === state.currentChat!.id ? { ...c, title: optimisticTitle } : c
              )
            : state.chats,
        }))
      }

      try {
        // Debug: log contexts presence before sending
        try {
          logger.info('sendMessage: preparing request', {
            hasContexts: Array.isArray(contexts),
            contextsCount: Array.isArray(contexts) ? contexts.length : 0,
            contextsPreview: Array.isArray(contexts)
              ? contexts.map((c: any) => ({
                  kind: c?.kind,
                  chatId: (c as any)?.chatId,
                  workflowId: (c as any)?.workflowId,
                  label: (c as any)?.label,
                }))
              : undefined,
          })
        } catch {}

        // Prepend design document to message if available
        const { streamingPlanContent } = get()
        let messageToSend = message
        if (streamingPlanContent?.trim()) {
          messageToSend = `Design Document:\n\n${streamingPlanContent}\n\n==============\n\nUser Query:\n\n${message}`
          logger.info('[DesignDocument] Prepending plan content to message', {
            planLength: streamingPlanContent.length,
            originalMessageLength: message.length,
            finalMessageLength: messageToSend.length,
          })
        }

        // Call copilot API
        const apiMode: CopilotTransportMode =
          mode === 'ask' ? 'ask' : mode === 'plan' ? 'plan' : 'agent'

        // Extract slash commands from contexts (lowercase) and filter them out from contexts
        // Map UI command IDs to API command IDs (e.g., "actions" -> "superagent")
        const uiToApiCommandMap: Record<string, string> = { actions: 'superagent' }
        const commands = contexts
          ?.filter((c) => c.kind === 'slash_command' && 'command' in c)
          .map((c) => {
            const uiCommand = (c as any).command.toLowerCase()
            return uiToApiCommandMap[uiCommand] || uiCommand
          }) as string[] | undefined
        const filteredContexts = contexts?.filter((c) => c.kind !== 'slash_command')

        const result = await sendStreamingMessage({
          message: messageToSend,
          userMessageId: userMessage.id,
          chatId: currentChat?.id,
          workflowId: workflowId || undefined,
          mode: apiMode,
          model: get().selectedModel,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream,
          fileAttachments,
          contexts: filteredContexts,
          commands: commands?.length ? commands : undefined,
          abortSignal: nextAbortController.signal,
        })

        if (result.success && result.stream) {
          await get().handleStreamingResponse(
            result.stream,
            streamingMessage.id,
            false,
            userMessage.id
          )
          set({ chatsLastLoadedAt: null, chatsLoadedForWorkflow: null })
        } else {
          if (result.error === 'Request was aborted') {
            return
          }

          // Check for specific status codes and provide custom messages
          let errorContent = result.error || 'Failed to send message'
          let errorType:
            | 'usage_limit'
            | 'unauthorized'
            | 'forbidden'
            | 'rate_limit'
            | 'upgrade_required'
            | undefined
          if (result.status === 401) {
            errorContent =
              '_Unauthorized request. You need a valid API key to use the copilot. You can get one by going to [sim.ai](https://sim.ai) settings and generating one there._'
            errorType = 'unauthorized'
          } else if (result.status === 402) {
            errorContent =
              '_Usage limit exceeded. To continue using this service, upgrade your plan or increase your usage limit to:_'
            errorType = 'usage_limit'
          } else if (result.status === 403) {
            errorContent =
              '_Provider config not allowed for non-enterprise users. Please remove the provider config and try again_'
            errorType = 'forbidden'
          } else if (result.status === 426) {
            errorContent =
              '_Please upgrade to the latest version of the Sim platform to continue using the copilot._'
            errorType = 'upgrade_required'
          } else if (result.status === 429) {
            errorContent = '_Provider rate limit exceeded. Please try again later._'
            errorType = 'rate_limit'
          }

          const errorMessage = createErrorMessage(streamingMessage.id, errorContent, errorType)
          set((state) => ({
            messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
            error: errorContent,
            isSendingMessage: false,
            abortController: null,
          }))
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const errorMessage = createErrorMessage(
          streamingMessage.id,
          'Sorry, I encountered an error while processing your message. Please try again.'
        )
        set((state) => ({
          messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
          error: error instanceof Error ? error.message : 'Failed to send message',
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    // Abort streaming
    abortMessage: (options?: { suppressContinueOption?: boolean }) => {
      const { abortController, isSendingMessage, messages } = get()
      if (!isSendingMessage || !abortController) return
      const suppressContinueOption = options?.suppressContinueOption === true
      set({ isAborting: true, suppressAbortContinueOption: suppressContinueOption })
      try {
        abortController.abort()
        stopStreamingUpdates()
        const lastMessage = messages[messages.length - 1]
        if (lastMessage && lastMessage.role === 'assistant') {
          const textContent =
            lastMessage.contentBlocks
              ?.filter((b) => b.type === 'text')
              .map((b: any) => b.content)
              .join('') || ''
          const nextContentBlocks = suppressContinueOption
            ? (lastMessage.contentBlocks ?? [])
            : appendContinueOptionBlock(
                lastMessage.contentBlocks ? [...lastMessage.contentBlocks] : []
              )
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === lastMessage.id
                ? {
                    ...msg,
                    content: suppressContinueOption
                      ? textContent.trim() || 'Message was aborted'
                      : appendContinueOption(textContent.trim() || 'Message was aborted'),
                    contentBlocks: nextContentBlocks,
                  }
                : msg
            ),
            isSendingMessage: false,
            isAborting: false,
            // Keep abortController so streaming loop can check signal.aborted
            // It will be nulled when streaming completes or new message starts
          }))
        } else {
          set({
            isSendingMessage: false,
            isAborting: false,
            // Keep abortController so streaming loop can check signal.aborted
          })
        }

        // Immediately put all in-progress tools into aborted state
        abortAllInProgressTools(set, get)

        // Persist whatever contentBlocks/text we have to keep ordering for reloads
        const { currentChat, streamingPlanContent, mode, selectedModel } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId: currentChat.id,
                messages: dbMessages,
                planArtifact: streamingPlanContent || null,
                config: {
                  mode,
                  model: selectedModel,
                },
              }),
            }).catch(() => {})
          } catch {}
        }
      } catch {
        set({ isSendingMessage: false, isAborting: false })
      }
    },

    // Implicit feedback (send a continuation) - minimal
    sendImplicitFeedback: async (implicitFeedback: string) => {
      const { workflowId, currentChat, mode, selectedModel } = get()
      if (!workflowId) return
      const abortController = new AbortController()
      set({ isSendingMessage: true, error: null, abortController })
      const newAssistantMessage = createStreamingMessage()
      set((state) => ({ messages: [...state.messages, newAssistantMessage] }))
      try {
        const apiMode: 'ask' | 'agent' | 'plan' =
          mode === 'ask' ? 'ask' : mode === 'plan' ? 'plan' : 'agent'
        const result = await sendStreamingMessage({
          message: 'Please continue your response.',
          chatId: currentChat?.id,
          workflowId,
          mode: apiMode,
          model: selectedModel,
          prefetch: get().agentPrefetch,
          createNewChat: !currentChat,
          stream: true,
          implicitFeedback,
          abortSignal: abortController.signal,
        })
        if (result.success && result.stream) {
          await get().handleStreamingResponse(result.stream, newAssistantMessage.id, false)
        } else {
          if (result.error === 'Request was aborted') return
          const errorMessage = createErrorMessage(
            newAssistantMessage.id,
            result.error || 'Failed to send implicit feedback'
          )
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === newAssistantMessage.id ? errorMessage : msg
            ),
            error: result.error || 'Failed to send implicit feedback',
            isSendingMessage: false,
            abortController: null,
          }))
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        const errorMessage = createErrorMessage(
          newAssistantMessage.id,
          'Sorry, I encountered an error while processing your feedback. Please try again.'
        )
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === newAssistantMessage.id ? errorMessage : msg
          ),
          error: error instanceof Error ? error.message : 'Failed to send implicit feedback',
          isSendingMessage: false,
          abortController: null,
        }))
      }
    },

    // Tool-call related APIs are stubbed for now
    setToolCallState: (toolCall: any, newState: any) => {
      try {
        const id: string | undefined = toolCall?.id
        if (!id) return
        const map = { ...get().toolCallsById }
        const current = map[id]
        if (!current) return
        // Preserve rejected state from being overridden
        if (
          isRejectedState(current.state) &&
          (newState === 'success' || newState === (ClientToolCallState as any).success)
        ) {
          return
        }
        let norm: ClientToolCallState = current.state
        if (newState === 'executing') norm = ClientToolCallState.executing
        else if (newState === 'errored' || newState === 'error') norm = ClientToolCallState.error
        else if (newState === 'rejected') norm = ClientToolCallState.rejected
        else if (newState === 'pending') norm = ClientToolCallState.pending
        else if (newState === 'success' || newState === 'accepted')
          norm = ClientToolCallState.success
        else if (newState === 'aborted') norm = ClientToolCallState.aborted
        else if (typeof newState === 'number') norm = newState as unknown as ClientToolCallState
        map[id] = {
          ...current,
          state: norm,
          display: resolveToolDisplay(current.name, norm, id, current.params),
        }
        set({ toolCallsById: map })
      } catch {}
    },

    updateToolCallParams: (toolCallId: string, params: Record<string, any>) => {
      try {
        if (!toolCallId) return
        const map = { ...get().toolCallsById }
        const current = map[toolCallId]
        if (!current) return
        const updatedParams = { ...current.params, ...params }
        map[toolCallId] = {
          ...current,
          params: updatedParams,
          display: resolveToolDisplay(current.name, current.state, toolCallId, updatedParams),
        }
        set({ toolCallsById: map })
      } catch {}
    },
    updatePreviewToolCallState: (
      toolCallState: 'accepted' | 'rejected' | 'error',
      toolCallId?: string
    ) => {
      const stateMap: Record<string, ClientToolCallState> = {
        accepted: ClientToolCallState.success,
        rejected: ClientToolCallState.rejected,
        error: ClientToolCallState.error,
      }
      const targetState = stateMap[toolCallState] || ClientToolCallState.success
      const { toolCallsById } = get()
      // Determine target tool
      let id = toolCallId
      if (!id) {
        // Prefer the latest assistant message's build/edit tool_call
        const messages = get().messages
        outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
          const m = messages[mi]
          if (m.role !== 'assistant' || !m.contentBlocks) continue
          const blocks = m.contentBlocks as any[]
          for (let bi = blocks.length - 1; bi >= 0; bi--) {
            const b = blocks[bi]
            if (b?.type === 'tool_call') {
              const tn = b.toolCall?.name
              if (tn === 'edit_workflow') {
                id = b.toolCall?.id
                break outer
              }
            }
          }
        }
        // Fallback to map if not found in messages
        if (!id) {
          const candidates = Object.values(toolCallsById).filter((t) => t.name === 'edit_workflow')
          id = candidates.length ? candidates[candidates.length - 1].id : undefined
        }
      }
      if (!id) return
      const current = toolCallsById[id]
      if (!current) return
      // Do not override a rejected tool with success
      if (isRejectedState(current.state) && targetState === (ClientToolCallState as any).success) {
        return
      }

      // Update store map
      const updatedMap = { ...toolCallsById }
      const updatedDisplay = resolveToolDisplay(current.name, targetState, id, current.params)
      updatedMap[id] = {
        ...current,
        state: targetState,
        display: updatedDisplay,
      }
      set({ toolCallsById: updatedMap })

      // Update inline content block in the latest assistant message
      set((s) => {
        const messages = [...s.messages]
        for (let mi = messages.length - 1; mi >= 0; mi--) {
          const m = messages[mi]
          if (m.role !== 'assistant' || !m.contentBlocks) continue
          let changed = false
          const blocks = m.contentBlocks.map((b: any) => {
            if (b.type === 'tool_call' && b.toolCall?.id === id) {
              changed = true
              const prev = b.toolCall || {}
              return {
                ...b,
                toolCall: {
                  ...prev,
                  id,
                  name: current.name,
                  state: targetState,
                  display: updatedDisplay,
                  params: current.params,
                },
              }
            }
            return b
          })
          if (changed) {
            messages[mi] = { ...m, contentBlocks: blocks }
            break
          }
        }
        return { messages }
      })

      // Notify backend mark-complete to finalize tool server-side
      try {
        fetch('/api/copilot/tools/mark-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            name: current.name,
            status:
              targetState === ClientToolCallState.success
                ? 200
                : targetState === ClientToolCallState.rejected
                  ? 409
                  : 500,
            message: toolCallState,
          }),
        }).catch(() => {})
      } catch {}
    },

    sendDocsMessage: async (query: string) => {
      await get().sendMessage(query)
    },

    saveChatMessages: async (_chatId: string) => {},

    loadCheckpoints: async (_chatId: string) => set({ checkpoints: [] }),

    loadMessageCheckpoints: async (chatId: string) => {
      const { workflowId } = get()
      if (!workflowId) return
      set({ isLoadingCheckpoints: true, checkpointError: null })
      try {
        const response = await fetch(`/api/copilot/checkpoints?chatId=${chatId}`)
        if (!response.ok) throw new Error(`Failed to load checkpoints: ${response.statusText}`)
        const data = await response.json()
        if (data.success && Array.isArray(data.checkpoints)) {
          const grouped = data.checkpoints.reduce((acc: Record<string, any[]>, cp: any) => {
            const key = cp.messageId || '__no_message__'
            acc[key] = acc[key] || []
            acc[key].push(cp)
            return acc
          }, {})
          set({ messageCheckpoints: grouped, isLoadingCheckpoints: false })
        } else {
          throw new Error('Invalid checkpoints response')
        }
      } catch (error) {
        set({
          isLoadingCheckpoints: false,
          checkpointError: error instanceof Error ? error.message : 'Failed to load checkpoints',
        })
      }
    },

    // Revert to a specific checkpoint and apply state locally
    revertToCheckpoint: async (checkpointId: string) => {
      const { workflowId } = get()
      if (!workflowId) return
      set({ isRevertingCheckpoint: true, checkpointError: null })
      try {
        const { messageCheckpoints } = get()
        const checkpointMessageId = Object.entries(messageCheckpoints).find(([, cps]) =>
          (cps || []).some((cp: any) => cp?.id === checkpointId)
        )?.[0]
        const response = await fetch('/api/copilot/checkpoints/revert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkpointId }),
        })
        if (!response.ok) {
          const errorText = await response.text().catch(() => '')
          throw new Error(errorText || `Failed to revert: ${response.statusText}`)
        }
        const result = await response.json()
        const reverted = result?.checkpoint?.workflowState || null
        if (reverted) {
          // Clear any active diff preview
          try {
            useWorkflowDiffStore.getState().clearDiff()
          } catch {}

          // Apply to main workflow store
          useWorkflowStore.setState({
            blocks: reverted.blocks || {},
            edges: reverted.edges || [],
            loops: reverted.loops || {},
            parallels: reverted.parallels || {},
            lastSaved: reverted.lastSaved || Date.now(),
            deploymentStatuses: reverted.deploymentStatuses || {},
          })

          // Extract and apply subblock values
          const values: Record<string, Record<string, any>> = {}
          Object.entries(reverted.blocks || {}).forEach(([blockId, block]: [string, any]) => {
            values[blockId] = {}
            Object.entries((block as any).subBlocks || {}).forEach(
              ([subId, sub]: [string, any]) => {
                values[blockId][subId] = (sub as any)?.value
              }
            )
          })
          const subState = useSubBlockStore.getState()
          useSubBlockStore.setState({
            workflowValues: {
              ...subState.workflowValues,
              [workflowId]: values,
            },
          })
        }
        if (checkpointMessageId) {
          const { messageCheckpoints: currentCheckpoints } = get()
          const updatedCheckpoints = { ...currentCheckpoints, [checkpointMessageId]: [] }
          set({ messageCheckpoints: updatedCheckpoints })
        }
        set({ isRevertingCheckpoint: false })
      } catch (error) {
        set({
          isRevertingCheckpoint: false,
          checkpointError: error instanceof Error ? error.message : 'Failed to revert checkpoint',
        })
        throw error
      }
    },
    getCheckpointsForMessage: (messageId: string) => {
      const { messageCheckpoints } = get()
      return messageCheckpoints[messageId] || []
    },
    saveMessageCheckpoint: async (messageId: string) => {
      if (!messageId) return false
      return saveMessageCheckpoint(messageId, get, set)
    },

    // Handle streaming response
    handleStreamingResponse: async (
      stream: ReadableStream,
      assistantMessageId: string,
      isContinuation = false,
      triggerUserMessageId?: string
    ) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      const startTimeMs = Date.now()

      const context: StreamingContext = {
        messageId: assistantMessageId,
        accumulatedContent: new StringBuilder(),
        contentBlocks: [],
        currentTextBlock: null,
        isInThinkingBlock: false,
        currentThinkingBlock: null,
        isInDesignWorkflowBlock: false,
        designWorkflowContent: '',
        pendingContent: '',
        doneEventCount: 0,
        subAgentContent: {},
        subAgentToolCalls: {},
        subAgentBlocks: {},
      }

      if (isContinuation) {
        const { messages } = get()
        const existingMessage = messages.find((m) => m.id === assistantMessageId)
        if (existingMessage) {
          if (existingMessage.content) context.accumulatedContent.append(existingMessage.content)
          context.contentBlocks = existingMessage.contentBlocks
            ? [...existingMessage.contentBlocks]
            : []
        }
      }

      const timeoutId = setTimeout(() => {
        logger.warn('Stream timeout reached, completing response')
        reader.cancel()
      }, 600000)

      try {
        for await (const data of parseSSEStream(reader, decoder)) {
          const { abortController } = get()
          if (abortController?.signal.aborted) {
            context.wasAborted = true
            const { suppressAbortContinueOption } = get()
            context.suppressContinueOption = suppressAbortContinueOption === true
            if (suppressAbortContinueOption) {
              set({ suppressAbortContinueOption: false })
            }
            context.pendingContent = ''
            finalizeThinkingBlock(context)
            stopStreamingUpdates()
            reader.cancel()
            break
          }

          // Log SSE events for debugging
          logger.info('[SSE] Received event', {
            type: data.type,
            hasSubAgent: !!data.subagent,
            subagent: data.subagent,
            dataPreview:
              typeof data.data === 'string'
                ? data.data.substring(0, 100)
                : JSON.stringify(data.data)?.substring(0, 100),
          })

          // Handle subagent_start to track parent tool call
          if (data.type === 'subagent_start') {
            const toolCallId = data.data?.tool_call_id
            if (toolCallId) {
              context.subAgentParentToolCallId = toolCallId
              // Mark the parent tool call as streaming
              const { toolCallsById } = get()
              const parentToolCall = toolCallsById[toolCallId]
              if (parentToolCall) {
                const updatedToolCall: CopilotToolCall = {
                  ...parentToolCall,
                  subAgentStreaming: true,
                }
                const updatedMap = { ...toolCallsById, [toolCallId]: updatedToolCall }
                set({ toolCallsById: updatedMap })
              }
              logger.info('[SSE] Subagent session started', {
                subagent: data.subagent,
                parentToolCallId: toolCallId,
              })
            }
            continue
          }

          // Handle subagent_end to finalize subagent content
          if (data.type === 'subagent_end') {
            const parentToolCallId = context.subAgentParentToolCallId
            if (parentToolCallId) {
              // Mark subagent streaming as complete
              const { toolCallsById } = get()
              const parentToolCall = toolCallsById[parentToolCallId]
              if (parentToolCall) {
                const updatedToolCall: CopilotToolCall = {
                  ...parentToolCall,
                  subAgentContent: context.subAgentContent[parentToolCallId] || '',
                  subAgentToolCalls: context.subAgentToolCalls[parentToolCallId] || [],
                  subAgentBlocks: context.subAgentBlocks[parentToolCallId] || [],
                  subAgentStreaming: false, // Done streaming
                }
                const updatedMap = { ...toolCallsById, [parentToolCallId]: updatedToolCall }
                set({ toolCallsById: updatedMap })
                logger.info('[SSE] Subagent session ended', {
                  subagent: data.subagent,
                  parentToolCallId,
                  contentLength: context.subAgentContent[parentToolCallId]?.length || 0,
                  toolCallCount: context.subAgentToolCalls[parentToolCallId]?.length || 0,
                })
              }
            }
            context.subAgentParentToolCallId = undefined
            continue
          }

          // Check if this is a subagent event (has subagent field)
          if (data.subagent) {
            const parentToolCallId = context.subAgentParentToolCallId
            if (!parentToolCallId) {
              logger.warn('[SSE] Subagent event without parent tool call ID', {
                type: data.type,
                subagent: data.subagent,
              })
              continue
            }

            logger.info('[SSE] Processing subagent event', {
              type: data.type,
              subagent: data.subagent,
              parentToolCallId,
              hasHandler: !!subAgentSSEHandlers[data.type],
            })

            const subAgentHandler = subAgentSSEHandlers[data.type]
            if (subAgentHandler) {
              await subAgentHandler(data, context, get, set)
            } else {
              logger.warn('[SSE] No handler for subagent event type', { type: data.type })
            }
            // Skip regular handlers for subagent events
            if (context.streamComplete) break
            continue
          }

          const handler = sseHandlers[data.type] || sseHandlers.default
          await handler(data, context, get, set)
          if (context.streamComplete) break
        }

        if (!context.wasAborted && sseHandlers.stream_end) {
          sseHandlers.stream_end({}, context, get, set)
        }

        if (streamingUpdateRAF !== null) {
          cancelAnimationFrame(streamingUpdateRAF)
          streamingUpdateRAF = null
        }
        streamingUpdateQueue.clear()

        let sanitizedContentBlocks: any[] = []
        if (context.contentBlocks && context.contentBlocks.length > 0) {
          const optimizedBlocks = createOptimizedContentBlocks(context.contentBlocks)
          sanitizedContentBlocks = optimizedBlocks.map((block: any) =>
            block.type === TEXT_BLOCK_TYPE && typeof block.content === 'string'
              ? { ...block, content: stripTodoTags(block.content) }
              : block
          )
        }
        if (context.wasAborted && !context.suppressContinueOption) {
          sanitizedContentBlocks = appendContinueOptionBlock(sanitizedContentBlocks)
        }

        if (context.contentBlocks) {
          context.contentBlocks.forEach((block) => {
            if (block.type === TEXT_BLOCK_TYPE || block.type === THINKING_BLOCK_TYPE) {
              contentBlockPool.release(block)
            }
          })
        }

        const finalContent = stripTodoTags(context.accumulatedContent.toString())
        const finalContentWithOptions =
          context.wasAborted && !context.suppressContinueOption
            ? appendContinueOption(finalContent)
            : finalContent
        set((state) => {
          const snapshotId = state.currentUserMessageId
          const nextSnapshots =
            snapshotId && state.messageSnapshots[snapshotId]
              ? (() => {
                  const updated = { ...state.messageSnapshots }
                  delete updated[snapshotId]
                  return updated
                })()
              : state.messageSnapshots
          return {
            messages: state.messages.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: finalContentWithOptions,
                    contentBlocks: sanitizedContentBlocks,
                  }
                : msg
            ),
            isSendingMessage: false,
            isAborting: false,
            abortController: null,
            currentUserMessageId: null,
            messageSnapshots: nextSnapshots,
          }
        })

        if (context.newChatId && !get().currentChat) {
          await get().handleNewChatCreation(context.newChatId)
        }

        // Process next message in queue if any
        const nextInQueue = get().messageQueue[0]
        if (nextInQueue) {
          // Use originalMessageId if available (from edit/resend), otherwise use queue entry id
          const messageIdToUse = nextInQueue.originalMessageId || nextInQueue.id
          logger.info('[Queue] Processing next queued message', {
            id: nextInQueue.id,
            originalMessageId: nextInQueue.originalMessageId,
            messageIdToUse,
            queueLength: get().messageQueue.length,
          })
          // Remove from queue and send
          get().removeFromQueue(nextInQueue.id)
          // Use setTimeout to avoid blocking the current execution
          setTimeout(() => {
            get().sendMessage(nextInQueue.content, {
              stream: true,
              fileAttachments: nextInQueue.fileAttachments,
              contexts: nextInQueue.contexts,
              messageId: messageIdToUse,
            })
          }, 100)
        }

        // Persist full message state (including contentBlocks), plan artifact, and config to database
        const { currentChat, streamingPlanContent, mode, selectedModel } = get()
        if (currentChat) {
          try {
            const currentMessages = get().messages
            // Debug: Log what we're about to serialize
            const lastMsg = currentMessages[currentMessages.length - 1]
            if (lastMsg?.role === 'assistant') {
              logger.info('[Stream Done] About to serialize - last message state', {
                id: lastMsg.id,
                contentLength: lastMsg.content?.length || 0,
                hasContentBlocks: !!lastMsg.contentBlocks,
                contentBlockCount: lastMsg.contentBlocks?.length || 0,
                contentBlockTypes: (lastMsg.contentBlocks as any[])?.map((b) => b?.type) || [],
              })
            }
            const dbMessages = validateMessagesForLLM(currentMessages)
            const config = {
              mode,
              model: selectedModel,
            }

            const saveResponse = await fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId: currentChat.id,
                messages: dbMessages,
                planArtifact: streamingPlanContent || null,
                config,
              }),
            })

            if (!saveResponse.ok) {
              const errorText = await saveResponse.text().catch(() => '')
              logger.error('[Stream Done] Failed to save messages to DB', {
                status: saveResponse.status,
                error: errorText,
              })
            } else {
              logger.info('[Stream Done] Successfully saved messages to DB', {
                messageCount: dbMessages.length,
              })
            }

            // Update local chat object with plan artifact and config
            set({
              currentChat: {
                ...currentChat,
                planArtifact: streamingPlanContent || null,
                config,
              },
            })
          } catch (err) {
            logger.error('[Stream Done] Exception saving messages', { error: String(err) })
          }
        }

        // Post copilot_stats record (input/output tokens can be null for now)
        try {
          // Removed: stats sending now occurs only on accept/reject with minimal payload
        } catch {}

        // Invalidate subscription queries to update usage
        setTimeout(() => {
          const queryClient = getQueryClient()
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
        }, 1000)
      } finally {
        clearTimeout(timeoutId)
      }
    },

    // Handle new chat creation from stream
    handleNewChatCreation: async (newChatId: string) => {
      const { mode, selectedModel, streamingPlanContent } = get()
      const newChat: CopilotChat = {
        id: newChatId,
        title: null,
        model: selectedModel,
        messages: get().messages,
        messageCount: get().messages.length,
        planArtifact: streamingPlanContent || null,
        config: {
          mode,
          model: selectedModel,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      // Abort any in-progress tools and clear diff on new chat creation
      abortAllInProgressTools(set, get)
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}

      set({
        currentChat: newChat,
        chats: [newChat, ...(get().chats || [])],
        chatsLastLoadedAt: null,
        chatsLoadedForWorkflow: null,
        planTodos: [],
        showPlanTodos: false,
        suppressAutoSelect: false,
      })
    },

    // Utilities
    clearError: () => set({ error: null }),
    clearSaveError: () => set({ saveError: null }),
    clearCheckpointError: () => set({ checkpointError: null }),
    retrySave: async (_chatId: string) => {},

    cleanup: () => {
      const { isSendingMessage } = get()
      if (isSendingMessage) get().abortMessage()
      if (streamingUpdateRAF !== null) {
        cancelAnimationFrame(streamingUpdateRAF)
        streamingUpdateRAF = null
      }
      streamingUpdateQueue.clear()
      // Clear any diff on cleanup
      try {
        useWorkflowDiffStore.getState().clearDiff()
      } catch {}
    },

    reset: () => {
      get().cleanup()
      // Abort in-progress tools prior to reset
      abortAllInProgressTools(set, get)
      set(initialState)
    },

    // Input controls
    setInputValue: (value: string) => set({ inputValue: value }),
    clearRevertState: () => set({ revertState: null }),

    // Todo list (UI only)
    setPlanTodos: (todos) => set({ planTodos: todos, showPlanTodos: true }),
    updatePlanTodoStatus: (id, status) => {
      set((state) => {
        const updated = state.planTodos.map((t) =>
          t.id === id
            ? { ...t, completed: status === 'completed', executing: status === 'executing' }
            : t
        )
        return { planTodos: updated }
      })
    },
    closePlanTodos: () => set({ showPlanTodos: false }),

    clearPlanArtifact: async () => {
      const { currentChat } = get()

      // Clear from local state
      set({ streamingPlanContent: '' })

      // Update database if we have a current chat
      if (currentChat) {
        try {
          const currentMessages = get().messages
          const dbMessages = validateMessagesForLLM(currentMessages)
          const { mode, selectedModel } = get()

          await fetch('/api/copilot/chat/update-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId: currentChat.id,
              messages: dbMessages,
              planArtifact: null,
              config: {
                mode,
                model: selectedModel,
              },
            }),
          })

          // Update local chat object
          set({
            currentChat: {
              ...currentChat,
              planArtifact: null,
            },
          })

          logger.info('[PlanArtifact] Cleared plan artifact', { chatId: currentChat.id })
        } catch (error) {
          logger.error('[PlanArtifact] Failed to clear plan artifact', error)
        }
      }
    },

    savePlanArtifact: async (content: string) => {
      const { currentChat } = get()

      // Update local state
      set({ streamingPlanContent: content })

      // Update database if we have a current chat
      if (currentChat) {
        try {
          const currentMessages = get().messages
          const dbMessages = validateMessagesForLLM(currentMessages)
          const { mode, selectedModel } = get()

          await fetch('/api/copilot/chat/update-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId: currentChat.id,
              messages: dbMessages,
              planArtifact: content,
              config: {
                mode,
                model: selectedModel,
              },
            }),
          })

          // Update local chat object
          set({
            currentChat: {
              ...currentChat,
              planArtifact: content,
            },
          })

          logger.info('[PlanArtifact] Saved plan artifact', {
            chatId: currentChat.id,
            contentLength: content.length,
          })
        } catch (error) {
          logger.error('[PlanArtifact] Failed to save plan artifact', error)
        }
      }
    },

    setSelectedModel: async (model) => {
      set({ selectedModel: model })
    },
    setAgentPrefetch: (prefetch) => set({ agentPrefetch: prefetch }),
    setEnabledModels: (models) => set({ enabledModels: models }),

    executeIntegrationTool: async (toolCallId: string) => {
      const { toolCallsById, workflowId } = get()
      const toolCall = toolCallsById[toolCallId]
      if (!toolCall || !workflowId) return

      const { id, name, params } = toolCall

      // Guard against double execution - skip if already executing or in terminal state
      if (toolCall.state === ClientToolCallState.executing || isTerminalState(toolCall.state)) {
        logger.info('[executeIntegrationTool] Skipping - already executing or terminal', {
          id,
          name,
          state: toolCall.state,
        })
        return
      }

      // Set to executing state
      const executingMap = { ...get().toolCallsById }
      executingMap[id] = {
        ...executingMap[id],
        state: ClientToolCallState.executing,
        display: resolveToolDisplay(name, ClientToolCallState.executing, id, params),
      }
      set({ toolCallsById: executingMap })
      logger.info('[toolCallsById] pending → executing (integration tool)', { id, name })

      try {
        const res = await fetch('/api/copilot/execute-tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolCallId: id,
            toolName: name,
            arguments: params || {},
            workflowId,
          }),
        })

        const result = await res.json()
        const success = result.success && result.result?.success
        const completeMap = { ...get().toolCallsById }

        // Do not override terminal review/rejected
        if (
          isRejectedState(completeMap[id]?.state) ||
          isReviewState(completeMap[id]?.state) ||
          isBackgroundState(completeMap[id]?.state)
        ) {
          return
        }

        completeMap[id] = {
          ...completeMap[id],
          state: success ? ClientToolCallState.success : ClientToolCallState.error,
          display: resolveToolDisplay(
            name,
            success ? ClientToolCallState.success : ClientToolCallState.error,
            id,
            params
          ),
        }
        set({ toolCallsById: completeMap })
        logger.info(`[toolCallsById] executing → ${success ? 'success' : 'error'} (integration)`, {
          id,
          name,
          result,
        })

        // Notify backend tool mark-complete endpoint
        try {
          await fetch('/api/copilot/tools/mark-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id,
              name: name || 'unknown_tool',
              status: success ? 200 : 500,
              message: success
                ? result.result?.output?.content
                : result.result?.error || result.error || 'Tool execution failed',
              data: success
                ? result.result?.output
                : {
                    error: result.result?.error || result.error,
                    output: result.result?.output,
                  },
            }),
          })
        } catch {}
      } catch (e) {
        const errorMap = { ...get().toolCallsById }
        // Do not override terminal review/rejected
        if (
          isRejectedState(errorMap[id]?.state) ||
          isReviewState(errorMap[id]?.state) ||
          isBackgroundState(errorMap[id]?.state)
        ) {
          return
        }
        errorMap[id] = {
          ...errorMap[id],
          state: ClientToolCallState.error,
          display: resolveToolDisplay(name, ClientToolCallState.error, id, params),
        }
        set({ toolCallsById: errorMap })
        logger.error('Integration tool execution failed', { id, name, error: e })
      }
    },

    skipIntegrationTool: (toolCallId: string) => {
      const { toolCallsById } = get()
      const toolCall = toolCallsById[toolCallId]
      if (!toolCall) return

      const { id, name, params } = toolCall

      // Set to rejected state
      const rejectedMap = { ...get().toolCallsById }
      rejectedMap[id] = {
        ...rejectedMap[id],
        state: ClientToolCallState.rejected,
        display: resolveToolDisplay(name, ClientToolCallState.rejected, id, params),
      }
      set({ toolCallsById: rejectedMap })
      logger.info('[toolCallsById] pending → rejected (integration tool skipped)', { id, name })

      // Notify backend tool mark-complete endpoint with skip status
      fetch('/api/copilot/tools/mark-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: name || 'unknown_tool',
          status: 200,
          message: 'Tool execution skipped by user',
          data: { skipped: true },
        }),
      }).catch(() => {})
    },

    loadAutoAllowedTools: async () => {
      try {
        logger.info('[AutoAllowedTools] Loading from API...')
        const res = await fetch('/api/copilot/auto-allowed-tools')
        logger.info('[AutoAllowedTools] Load response', { status: res.status, ok: res.ok })
        if (res.ok) {
          const data = await res.json()
          const tools = data.autoAllowedTools || []
          set({ autoAllowedTools: tools })
          logger.info('[AutoAllowedTools] Loaded successfully', { count: tools.length, tools })
        } else {
          logger.warn('[AutoAllowedTools] Load failed with status', { status: res.status })
        }
      } catch (err) {
        logger.error('[AutoAllowedTools] Failed to load', { error: err })
      }
    },

    addAutoAllowedTool: async (toolId: string) => {
      try {
        logger.info('[AutoAllowedTools] Adding tool...', { toolId })
        const res = await fetch('/api/copilot/auto-allowed-tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolId }),
        })
        logger.info('[AutoAllowedTools] API response', { toolId, status: res.status, ok: res.ok })
        if (res.ok) {
          const data = await res.json()
          logger.info('[AutoAllowedTools] API returned', { toolId, tools: data.autoAllowedTools })
          set({ autoAllowedTools: data.autoAllowedTools || [] })
          logger.info('[AutoAllowedTools] Added tool to store', { toolId })

          // Auto-execute all pending tools of the same type
          const { toolCallsById, executeIntegrationTool } = get()
          const pendingToolCalls = Object.values(toolCallsById).filter(
            (tc) => tc.name === toolId && tc.state === ClientToolCallState.pending
          )
          if (pendingToolCalls.length > 0) {
            const isIntegrationTool = !CLASS_TOOL_METADATA[toolId]
            logger.info('[AutoAllowedTools] Auto-executing pending tools', {
              toolId,
              count: pendingToolCalls.length,
              isIntegrationTool,
            })
            for (const tc of pendingToolCalls) {
              if (isIntegrationTool) {
                // Integration tools use executeIntegrationTool
                executeIntegrationTool(tc.id).catch((err) => {
                  logger.error('[AutoAllowedTools] Auto-execute pending integration tool failed', {
                    toolCallId: tc.id,
                    toolId,
                    error: err,
                  })
                })
              } else {
                // Client tools with interrupts use handleAccept
                const inst = getClientTool(tc.id) as any
                if (inst && typeof inst.handleAccept === 'function') {
                  Promise.resolve()
                    .then(() => inst.handleAccept(tc.params || {}))
                    .catch((err: any) => {
                      logger.error('[AutoAllowedTools] Auto-execute pending client tool failed', {
                        toolCallId: tc.id,
                        toolId,
                        error: err,
                      })
                    })
                }
              }
            }
          }
        }
      } catch (err) {
        logger.error('[AutoAllowedTools] Failed to add tool', { toolId, error: err })
      }
    },

    removeAutoAllowedTool: async (toolId: string) => {
      try {
        const res = await fetch(
          `/api/copilot/auto-allowed-tools?toolId=${encodeURIComponent(toolId)}`,
          {
            method: 'DELETE',
          }
        )
        if (res.ok) {
          const data = await res.json()
          set({ autoAllowedTools: data.autoAllowedTools || [] })
          logger.info('[AutoAllowedTools] Removed tool', { toolId })
        }
      } catch (err) {
        logger.error('[AutoAllowedTools] Failed to remove tool', { toolId, error: err })
      }
    },

    isToolAutoAllowed: (toolId: string) => {
      const { autoAllowedTools } = get()
      return autoAllowedTools.includes(toolId)
    },

    // Credential masking
    loadSensitiveCredentialIds: async () => {
      try {
        const res = await fetch('/api/copilot/execute-copilot-server-tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolName: 'get_credentials', payload: {} }),
        })
        if (!res.ok) {
          logger.warn('[loadSensitiveCredentialIds] Failed to fetch credentials', {
            status: res.status,
          })
          return
        }
        const json = await res.json()
        // Credentials are at result.oauth.connected.credentials
        const credentials = json?.result?.oauth?.connected?.credentials || []
        logger.info('[loadSensitiveCredentialIds] Response', {
          hasResult: !!json?.result,
          credentialCount: credentials.length,
        })
        const ids = new Set<string>()
        for (const cred of credentials) {
          if (cred?.id) {
            ids.add(cred.id)
          }
        }
        set({ sensitiveCredentialIds: ids })
        logger.info('[loadSensitiveCredentialIds] Loaded credential IDs', {
          count: ids.size,
        })
      } catch (err) {
        logger.warn('[loadSensitiveCredentialIds] Error loading credentials', err)
      }
    },

    maskCredentialValue: (value: string) => {
      const { sensitiveCredentialIds } = get()
      if (!value || sensitiveCredentialIds.size === 0) return value

      let masked = value
      // Sort by length descending to mask longer IDs first
      const sortedIds = Array.from(sensitiveCredentialIds).sort((a, b) => b.length - a.length)
      for (const id of sortedIds) {
        if (id && masked.includes(id)) {
          masked = masked.split(id).join('••••••••')
        }
      }
      return masked
    },

    // Message queue actions
    addToQueue: (message, options) => {
      const queuedMessage: import('./types').QueuedMessage = {
        id: crypto.randomUUID(),
        content: message,
        fileAttachments: options?.fileAttachments,
        contexts: options?.contexts,
        queuedAt: Date.now(),
        originalMessageId: options?.messageId,
      }
      set({ messageQueue: [...get().messageQueue, queuedMessage] })
      logger.info('[Queue] Message added to queue', {
        id: queuedMessage.id,
        originalMessageId: options?.messageId,
        queueLength: get().messageQueue.length,
      })
    },

    removeFromQueue: (id) => {
      set({ messageQueue: get().messageQueue.filter((m) => m.id !== id) })
      logger.info('[Queue] Message removed from queue', {
        id,
        queueLength: get().messageQueue.length,
      })
    },

    moveUpInQueue: (id) => {
      const queue = [...get().messageQueue]
      const index = queue.findIndex((m) => m.id === id)
      if (index > 0) {
        const item = queue[index]
        queue.splice(index, 1)
        queue.splice(index - 1, 0, item)
        set({ messageQueue: queue })
        logger.info('[Queue] Message moved up in queue', { id, newIndex: index - 1 })
      }
    },

    sendNow: async (id) => {
      const queue = get().messageQueue
      const message = queue.find((m) => m.id === id)
      if (!message) return

      // Remove from queue first
      get().removeFromQueue(id)

      // If currently sending, abort and send this one
      const { isSendingMessage } = get()
      if (isSendingMessage) {
        get().abortMessage({ suppressContinueOption: true })
        // Wait a tick for abort to complete
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // Use originalMessageId if available (from edit/resend), otherwise use queue entry id
      const messageIdToUse = message.originalMessageId || message.id

      // Send the message
      await get().sendMessage(message.content, {
        stream: true,
        fileAttachments: message.fileAttachments,
        contexts: message.contexts,
        messageId: messageIdToUse,
      })
    },

    clearQueue: () => {
      set({ messageQueue: [] })
      logger.info('[Queue] Queue cleared')
    },
  }))
)

// Sync class-based tool instance state changes back into the store map
try {
  registerToolStateSync((toolCallId: string, nextState: any) => {
    const state = useCopilotStore.getState()
    const current = state.toolCallsById[toolCallId]
    if (!current) return
    let mapped: ClientToolCallState = current.state
    if (nextState === 'executing') mapped = ClientToolCallState.executing
    else if (nextState === 'pending') mapped = ClientToolCallState.pending
    else if (nextState === 'success' || nextState === 'accepted')
      mapped = ClientToolCallState.success
    else if (nextState === 'error' || nextState === 'errored') mapped = ClientToolCallState.error
    else if (nextState === 'rejected') mapped = ClientToolCallState.rejected
    else if (nextState === 'aborted') mapped = ClientToolCallState.aborted
    else if (nextState === 'review') mapped = (ClientToolCallState as any).review
    else if (nextState === 'background') mapped = (ClientToolCallState as any).background
    else if (typeof nextState === 'number') mapped = nextState as unknown as ClientToolCallState

    // Store-authoritative gating: ignore invalid/downgrade transitions
    const isTerminal = (s: ClientToolCallState) =>
      s === ClientToolCallState.success ||
      s === ClientToolCallState.error ||
      s === ClientToolCallState.rejected ||
      s === ClientToolCallState.aborted ||
      (s as any) === (ClientToolCallState as any).review ||
      (s as any) === (ClientToolCallState as any).background

    // If we've already reached a terminal state, ignore any further non-terminal updates
    if (isTerminal(current.state) && !isTerminal(mapped)) {
      return
    }
    // Prevent downgrades (executing → pending, pending → generating)
    if (
      (current.state === ClientToolCallState.executing && mapped === ClientToolCallState.pending) ||
      (current.state === ClientToolCallState.pending &&
        mapped === (ClientToolCallState as any).generating)
    ) {
      return
    }
    // No-op if unchanged
    if (mapped === current.state) return
    const updated = {
      ...state.toolCallsById,
      [toolCallId]: {
        ...current,
        state: mapped,
        display: resolveToolDisplay(current.name, mapped, toolCallId, current.params),
      },
    }
    useCopilotStore.setState({ toolCallsById: updated })
  })
} catch {}
