import type { LucideIcon } from 'lucide-react'
import {
  Blocks,
  BookOpen,
  Bug,
  Check,
  CheckCircle,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Database,
  FileCode,
  FileText,
  FlaskConical,
  GitBranch,
  Globe,
  Globe2,
  Grid2x2,
  Grid2x2Check,
  Grid2x2X,
  Info,
  Key,
  KeyRound,
  ListChecks,
  ListFilter,
  ListTodo,
  Loader2,
  MessageSquare,
  MinusCircle,
  Moon,
  Navigation,
  Pencil,
  PencilLine,
  Play,
  PlugZap,
  Plus,
  Rocket,
  Search,
  Server,
  Settings2,
  Sparkles,
  Tag,
  TerminalSquare,
  WorkflowIcon,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { getLatestBlock } from '@/blocks/registry'
import { getCustomTool } from '@/hooks/queries/custom-tools'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export enum ClientToolCallState {
  generating = 'generating',
  pending = 'pending',
  executing = 'executing',
  aborted = 'aborted',
  rejected = 'rejected',
  success = 'success',
  error = 'error',
  review = 'review',
  background = 'background',
}

export interface ClientToolDisplay {
  text: string
  icon: LucideIcon
}

export type DynamicTextFormatter = (
  params: Record<string, any>,
  state: ClientToolCallState
) => string | undefined

export interface ToolUIConfig {
  isSpecial?: boolean
  subagent?: boolean
  interrupt?: boolean
  customRenderer?: string
  paramsTable?: any
  dynamicText?: DynamicTextFormatter
  secondaryAction?: any
  alwaysExpanded?: boolean
  subagentLabels?: {
    streaming: string
    completed: string
  }
}

interface ToolMetadata {
  displayNames: Partial<Record<ClientToolCallState, ClientToolDisplay>>
  interrupt?: {
    accept: ClientToolDisplay
    reject: ClientToolDisplay
  }
  getDynamicText?: DynamicTextFormatter
  uiConfig?: {
    isSpecial?: boolean
    subagent?: {
      streamingLabel?: string
      completedLabel?: string
      shouldCollapse?: boolean
      outputArtifacts?: string[]
      hideThinkingText?: boolean
    }
    interrupt?: any
    customRenderer?: string
    paramsTable?: any
    secondaryAction?: any
    alwaysExpanded?: boolean
  }
}

interface ToolDisplayEntry {
  displayNames: Partial<Record<ClientToolCallState, ClientToolDisplay>>
  uiConfig?: ToolUIConfig
}

type WorkflowDataType = 'global_variables' | 'custom_tools' | 'mcp_tools' | 'files'

type NavigationDestination = 'workflow' | 'logs' | 'templates' | 'vector_db' | 'settings'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (remMins > 0) return `${hours}h ${remMins}m`
  return `${hours}h`
}

function toUiConfig(metadata?: ToolMetadata): ToolUIConfig | undefined {
  const legacy = metadata?.uiConfig
  const subagent = legacy?.subagent
  const dynamicText = metadata?.getDynamicText
  if (!legacy && !dynamicText) return undefined

  const config: ToolUIConfig = {
    isSpecial: legacy?.isSpecial === true,
    subagent: !!legacy?.subagent,
    interrupt: !!legacy?.interrupt,
    customRenderer: legacy?.customRenderer,
    paramsTable: legacy?.paramsTable,
    dynamicText,
    secondaryAction: legacy?.secondaryAction,
    alwaysExpanded: legacy?.alwaysExpanded,
  }

  if (subagent?.streamingLabel || subagent?.completedLabel) {
    config.subagentLabels = {
      streaming: subagent.streamingLabel || '',
      completed: subagent.completedLabel || '',
    }
  }

  return config
}

function toToolDisplayEntry(metadata?: ToolMetadata): ToolDisplayEntry {
  return {
    displayNames: metadata?.displayNames || {},
    uiConfig: toUiConfig(metadata),
  }
}

const META_auth: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Authenticating', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Authenticating', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Authenticating', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Authenticated', icon: KeyRound },
    [ClientToolCallState.error]: { text: 'Failed to authenticate', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped auth', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted auth', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Authenticating',
      completedLabel: 'Authenticated',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_check_deployment_status: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Checking deployment status',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Checking deployment status', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Checking deployment status', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Checked deployment status', icon: Rocket },
    [ClientToolCallState.error]: { text: 'Failed to check deployment status', icon: X },
    [ClientToolCallState.aborted]: {
      text: 'Aborted checking deployment status',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped checking deployment status',
      icon: XCircle,
    },
  },
  interrupt: undefined,
}

const META_checkoff_todo: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Marking todo', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Marking todo', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Marked todo complete', icon: Check },
    [ClientToolCallState.error]: { text: 'Failed to mark todo', icon: XCircle },
  },
}

const META_crawl_website: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Crawling website', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Crawling website', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Crawling website', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Crawled website', icon: Globe },
    [ClientToolCallState.error]: { text: 'Failed to crawl website', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted crawling website', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped crawling website', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.url && typeof params.url === 'string') {
      const url = params.url

      switch (state) {
        case ClientToolCallState.success:
          return `Crawled ${url}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Crawling ${url}`
        case ClientToolCallState.error:
          return `Failed to crawl ${url}`
        case ClientToolCallState.aborted:
          return `Aborted crawling ${url}`
        case ClientToolCallState.rejected:
          return `Skipped crawling ${url}`
      }
    }
    return undefined
  },
}

const META_create_workspace_mcp_server: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to create MCP server',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Create MCP server?', icon: Server },
    [ClientToolCallState.executing]: { text: 'Creating MCP server', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Created MCP server', icon: Server },
    [ClientToolCallState.error]: { text: 'Failed to create MCP server', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted creating MCP server', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped creating MCP server', icon: XCircle },
  },
  interrupt: {
    accept: { text: 'Create', icon: Plus },
    reject: { text: 'Skip', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const name = params?.name || 'MCP server'
    switch (state) {
      case ClientToolCallState.success:
        return `Created MCP server "${name}"`
      case ClientToolCallState.executing:
        return `Creating MCP server "${name}"`
      case ClientToolCallState.generating:
        return `Preparing to create "${name}"`
      case ClientToolCallState.pending:
        return `Create MCP server "${name}"?`
      case ClientToolCallState.error:
        return `Failed to create "${name}"`
    }
    return undefined
  },
}

const META_custom_tool: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Managing custom tool', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Managing custom tool', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Managing custom tool', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Managed custom tool', icon: Wrench },
    [ClientToolCallState.error]: { text: 'Failed custom tool', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped custom tool', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted custom tool', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Managing custom tool',
      completedLabel: 'Custom tool managed',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_debug: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Debugging', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Debugging', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Debugging', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Debugged', icon: Bug },
    [ClientToolCallState.error]: { text: 'Failed to debug', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped debug', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted debug', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Debugging',
      completedLabel: 'Debugged',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_deploy: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Deploying', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Deploying', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Deploying', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Deployed', icon: Rocket },
    [ClientToolCallState.error]: { text: 'Failed to deploy', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped deploy', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted deploy', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Deploying',
      completedLabel: 'Deployed',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_deploy_api: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to deploy API',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Deploy as API?', icon: Rocket },
    [ClientToolCallState.executing]: { text: 'Deploying API', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Deployed API', icon: Rocket },
    [ClientToolCallState.error]: { text: 'Failed to deploy API', icon: XCircle },
    [ClientToolCallState.aborted]: {
      text: 'Aborted deploying API',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped deploying API',
      icon: XCircle,
    },
  },
  interrupt: {
    accept: { text: 'Deploy', icon: Rocket },
    reject: { text: 'Skip', icon: XCircle },
  },
  uiConfig: {
    isSpecial: true,
    interrupt: {
      accept: { text: 'Deploy', icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
  },
  getDynamicText: (params, state) => {
    const action = params?.action === 'undeploy' ? 'undeploy' : 'deploy'

    const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
    const isAlreadyDeployed = workflowId
      ? useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)?.isDeployed
      : false

    let actionText = action
    let actionTextIng = action === 'undeploy' ? 'undeploying' : 'deploying'
    const actionTextPast = action === 'undeploy' ? 'undeployed' : 'deployed'

    if (action === 'deploy' && isAlreadyDeployed) {
      actionText = 'redeploy'
      actionTextIng = 'redeploying'
    }

    const actionCapitalized = actionText.charAt(0).toUpperCase() + actionText.slice(1)

    switch (state) {
      case ClientToolCallState.success:
        return `API ${actionTextPast}`
      case ClientToolCallState.executing:
        return `${actionCapitalized}ing API`
      case ClientToolCallState.generating:
        return `Preparing to ${actionText} API`
      case ClientToolCallState.pending:
        return `${actionCapitalized} API?`
      case ClientToolCallState.error:
        return `Failed to ${actionText} API`
      case ClientToolCallState.aborted:
        return `Aborted ${actionTextIng} API`
      case ClientToolCallState.rejected:
        return `Skipped ${actionTextIng} API`
    }
    return undefined
  },
}

const META_deploy_chat: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to deploy chat',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Deploy as chat?', icon: MessageSquare },
    [ClientToolCallState.executing]: { text: 'Deploying chat', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Deployed chat', icon: MessageSquare },
    [ClientToolCallState.error]: { text: 'Failed to deploy chat', icon: XCircle },
    [ClientToolCallState.aborted]: {
      text: 'Aborted deploying chat',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped deploying chat',
      icon: XCircle,
    },
  },
  interrupt: {
    accept: { text: 'Deploy Chat', icon: MessageSquare },
    reject: { text: 'Skip', icon: XCircle },
  },
  uiConfig: {
    isSpecial: true,
    interrupt: {
      accept: { text: 'Deploy Chat', icon: MessageSquare },
      reject: { text: 'Skip', icon: XCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
  },
  getDynamicText: (params, state) => {
    const action = params?.action === 'undeploy' ? 'undeploy' : 'deploy'

    switch (state) {
      case ClientToolCallState.success:
        return action === 'undeploy' ? 'Chat undeployed' : 'Chat deployed'
      case ClientToolCallState.executing:
        return action === 'undeploy' ? 'Undeploying chat' : 'Deploying chat'
      case ClientToolCallState.generating:
        return `Preparing to ${action} chat`
      case ClientToolCallState.pending:
        return action === 'undeploy' ? 'Undeploy chat?' : 'Deploy as chat?'
      case ClientToolCallState.error:
        return `Failed to ${action} chat`
      case ClientToolCallState.aborted:
        return action === 'undeploy' ? 'Aborted undeploying chat' : 'Aborted deploying chat'
      case ClientToolCallState.rejected:
        return action === 'undeploy' ? 'Skipped undeploying chat' : 'Skipped deploying chat'
    }
    return undefined
  },
}

const META_deploy_mcp: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to deploy to MCP',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Deploy to MCP server?', icon: Server },
    [ClientToolCallState.executing]: { text: 'Deploying to MCP', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Deployed to MCP', icon: Server },
    [ClientToolCallState.error]: { text: 'Failed to deploy to MCP', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted MCP deployment', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped MCP deployment', icon: XCircle },
  },
  interrupt: {
    accept: { text: 'Deploy', icon: Server },
    reject: { text: 'Skip', icon: XCircle },
  },
  uiConfig: {
    isSpecial: true,
    interrupt: {
      accept: { text: 'Deploy', icon: Server },
      reject: { text: 'Skip', icon: XCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
  },
  getDynamicText: (params, state) => {
    const toolName = params?.toolName || 'workflow'
    switch (state) {
      case ClientToolCallState.success:
        return `Deployed "${toolName}" to MCP`
      case ClientToolCallState.executing:
        return `Deploying "${toolName}" to MCP`
      case ClientToolCallState.generating:
        return `Preparing to deploy to MCP`
      case ClientToolCallState.pending:
        return `Deploy "${toolName}" to MCP?`
      case ClientToolCallState.error:
        return `Failed to deploy to MCP`
    }
    return undefined
  },
}

const META_edit: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Editing', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Editing', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Editing', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Edited', icon: Pencil },
    [ClientToolCallState.error]: { text: 'Failed to apply edit', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped edit', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted edit', icon: XCircle },
  },
  uiConfig: {
    isSpecial: true,
    subagent: {
      streamingLabel: 'Editing',
      completedLabel: 'Edited',
      shouldCollapse: false, // Edit subagent stays expanded
      outputArtifacts: ['edit_summary'],
      hideThinkingText: true, // We show WorkflowEditSummary instead
    },
  },
}

const META_edit_workflow: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Editing your workflow', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Editing your workflow', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Edited your workflow', icon: Grid2x2Check },
    [ClientToolCallState.error]: { text: 'Failed to edit your workflow', icon: XCircle },
    [ClientToolCallState.review]: { text: 'Review your workflow changes', icon: Grid2x2 },
    [ClientToolCallState.rejected]: { text: 'Rejected workflow changes', icon: Grid2x2X },
    [ClientToolCallState.aborted]: { text: 'Aborted editing your workflow', icon: MinusCircle },
    [ClientToolCallState.pending]: { text: 'Editing your workflow', icon: Loader2 },
  },
  uiConfig: {
    isSpecial: true,
    customRenderer: 'edit_summary',
  },
}

const META_evaluate: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Evaluating', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Evaluating', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Evaluating', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Evaluated', icon: ClipboardCheck },
    [ClientToolCallState.error]: { text: 'Failed to evaluate', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped evaluation', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted evaluation', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Evaluating',
      completedLabel: 'Evaluated',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_get_block_config: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Getting block config', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Getting block config', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Getting block config', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Retrieved block config', icon: FileCode },
    [ClientToolCallState.error]: { text: 'Failed to get block config', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted getting block config', icon: XCircle },
    [ClientToolCallState.rejected]: {
      text: 'Skipped getting block config',
      icon: MinusCircle,
    },
  },
  getDynamicText: (params, state) => {
    if (params?.blockType && typeof params.blockType === 'string') {
      const blockConfig = getLatestBlock(params.blockType)
      const blockName = (blockConfig?.name ?? params.blockType.replace(/_/g, ' ')).toLowerCase()
      const opSuffix = params.operation ? ` (${params.operation})` : ''

      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved ${blockName}${opSuffix} config`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Retrieving ${blockName}${opSuffix} config`
        case ClientToolCallState.error:
          return `Failed to retrieve ${blockName}${opSuffix} config`
        case ClientToolCallState.aborted:
          return `Aborted retrieving ${blockName}${opSuffix} config`
        case ClientToolCallState.rejected:
          return `Skipped retrieving ${blockName}${opSuffix} config`
      }
    }
    return undefined
  },
}

const META_get_block_options: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Getting block operations', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Getting block operations', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Getting block operations', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Retrieved block operations', icon: ListFilter },
    [ClientToolCallState.error]: { text: 'Failed to get block operations', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted getting block operations', icon: XCircle },
    [ClientToolCallState.rejected]: {
      text: 'Skipped getting block operations',
      icon: MinusCircle,
    },
  },
  getDynamicText: (params, state) => {
    const blockId =
      (params as any)?.blockId ||
      (params as any)?.blockType ||
      (params as any)?.block_id ||
      (params as any)?.block_type
    if (typeof blockId === 'string') {
      const blockConfig = getLatestBlock(blockId)
      const blockName = (blockConfig?.name ?? blockId.replace(/_/g, ' ')).toLowerCase()

      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved ${blockName} operations`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Retrieving ${blockName} operations`
        case ClientToolCallState.error:
          return `Failed to retrieve ${blockName} operations`
        case ClientToolCallState.aborted:
          return `Aborted retrieving ${blockName} operations`
        case ClientToolCallState.rejected:
          return `Skipped retrieving ${blockName} operations`
      }
    }
    return undefined
  },
}

const META_get_block_outputs: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Getting block outputs', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Getting block outputs', icon: Tag },
    [ClientToolCallState.executing]: { text: 'Getting block outputs', icon: Loader2 },
    [ClientToolCallState.aborted]: { text: 'Aborted getting outputs', icon: XCircle },
    [ClientToolCallState.success]: { text: 'Retrieved block outputs', icon: Tag },
    [ClientToolCallState.error]: { text: 'Failed to get outputs', icon: X },
    [ClientToolCallState.rejected]: { text: 'Skipped getting outputs', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const blockIds = params?.blockIds
    if (blockIds && Array.isArray(blockIds) && blockIds.length > 0) {
      const count = blockIds.length
      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved outputs for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Getting outputs for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.error:
          return `Failed to get outputs for ${count} block${count > 1 ? 's' : ''}`
      }
    }
    return undefined
  },
}

const META_get_block_upstream_references: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Getting upstream references', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Getting upstream references', icon: GitBranch },
    [ClientToolCallState.executing]: { text: 'Getting upstream references', icon: Loader2 },
    [ClientToolCallState.aborted]: { text: 'Aborted getting references', icon: XCircle },
    [ClientToolCallState.success]: { text: 'Retrieved upstream references', icon: GitBranch },
    [ClientToolCallState.error]: { text: 'Failed to get references', icon: X },
    [ClientToolCallState.rejected]: { text: 'Skipped getting references', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const blockIds = params?.blockIds
    if (blockIds && Array.isArray(blockIds) && blockIds.length > 0) {
      const count = blockIds.length
      switch (state) {
        case ClientToolCallState.success:
          return `Retrieved references for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Getting references for ${count} block${count > 1 ? 's' : ''}`
        case ClientToolCallState.error:
          return `Failed to get references for ${count} block${count > 1 ? 's' : ''}`
      }
    }
    return undefined
  },
}

const META_get_blocks_and_tools: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Exploring available options', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Exploring available options', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Exploring available options', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Explored available options', icon: Blocks },
    [ClientToolCallState.error]: { text: 'Failed to explore options', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted exploring options', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped exploring options', icon: MinusCircle },
  },
  interrupt: undefined,
}

const META_get_blocks_metadata: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Searching block choices', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Searching block choices', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Searching block choices', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Searched block choices', icon: ListFilter },
    [ClientToolCallState.error]: { text: 'Failed to search block choices', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted searching block choices', icon: XCircle },
    [ClientToolCallState.rejected]: {
      text: 'Skipped searching block choices',
      icon: MinusCircle,
    },
  },
  getDynamicText: (params, state) => {
    if (params?.blockIds && Array.isArray(params.blockIds) && params.blockIds.length > 0) {
      const blockList = params.blockIds
        .slice(0, 3)
        .map((blockId) => blockId.replace(/_/g, ' '))
        .join(', ')
      const more = params.blockIds.length > 3 ? '...' : ''
      const blocks = `${blockList}${more}`

      switch (state) {
        case ClientToolCallState.success:
          return `Searched ${blocks}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Searching ${blocks}`
        case ClientToolCallState.error:
          return `Failed to search ${blocks}`
        case ClientToolCallState.aborted:
          return `Aborted searching ${blocks}`
        case ClientToolCallState.rejected:
          return `Skipped searching ${blocks}`
      }
    }
    return undefined
  },
}

const META_get_credentials: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Fetching connected integrations', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Fetching connected integrations', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Fetching connected integrations', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Fetched connected integrations', icon: Key },
    [ClientToolCallState.error]: {
      text: 'Failed to fetch connected integrations',
      icon: XCircle,
    },
    [ClientToolCallState.aborted]: {
      text: 'Aborted fetching connected integrations',
      icon: MinusCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped fetching connected integrations',
      icon: MinusCircle,
    },
  },
}

const META_get_examples_rag: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Fetching examples', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Fetching examples', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Fetching examples', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Fetched examples', icon: Search },
    [ClientToolCallState.error]: { text: 'Failed to fetch examples', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted getting examples', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped getting examples', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.query && typeof params.query === 'string') {
      const query = params.query

      switch (state) {
        case ClientToolCallState.success:
          return `Found examples for ${query}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Searching examples for ${query}`
        case ClientToolCallState.error:
          return `Failed to find examples for ${query}`
        case ClientToolCallState.aborted:
          return `Aborted searching examples for ${query}`
        case ClientToolCallState.rejected:
          return `Skipped searching examples for ${query}`
      }
    }
    return undefined
  },
}

const META_get_operations_examples: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Designing workflow component', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Designing workflow component', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Designing workflow component', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Designed workflow component', icon: Zap },
    [ClientToolCallState.error]: { text: 'Failed to design workflow component', icon: XCircle },
    [ClientToolCallState.aborted]: {
      text: 'Aborted designing workflow component',
      icon: MinusCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped designing workflow component',
      icon: MinusCircle,
    },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.query && typeof params.query === 'string') {
      const query = params.query

      switch (state) {
        case ClientToolCallState.success:
          return `Designed ${query}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Designing ${query}`
        case ClientToolCallState.error:
          return `Failed to design ${query}`
        case ClientToolCallState.aborted:
          return `Aborted designing ${query}`
        case ClientToolCallState.rejected:
          return `Skipped designing ${query}`
      }
    }
    return undefined
  },
}

const META_get_page_contents: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Getting page contents', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Getting page contents', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Getting page contents', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Retrieved page contents', icon: FileText },
    [ClientToolCallState.error]: { text: 'Failed to get page contents', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted getting page contents', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped getting page contents', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.urls && Array.isArray(params.urls) && params.urls.length > 0) {
      const firstUrl = String(params.urls[0])
      const count = params.urls.length

      switch (state) {
        case ClientToolCallState.success:
          return count > 1 ? `Retrieved ${count} pages` : `Retrieved ${firstUrl}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return count > 1 ? `Getting ${count} pages` : `Getting ${firstUrl}`
        case ClientToolCallState.error:
          return count > 1 ? `Failed to get ${count} pages` : `Failed to get ${firstUrl}`
        case ClientToolCallState.aborted:
          return count > 1 ? `Aborted getting ${count} pages` : `Aborted getting ${firstUrl}`
        case ClientToolCallState.rejected:
          return count > 1 ? `Skipped getting ${count} pages` : `Skipped getting ${firstUrl}`
      }
    }
    return undefined
  },
}

const META_get_trigger_blocks: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Finding trigger blocks', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Finding trigger blocks', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Finding trigger blocks', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Found trigger blocks', icon: ListFilter },
    [ClientToolCallState.error]: { text: 'Failed to find trigger blocks', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted finding trigger blocks', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped finding trigger blocks', icon: MinusCircle },
  },
  interrupt: undefined,
}

const META_get_trigger_examples: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Selecting a trigger', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Selecting a trigger', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Selecting a trigger', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Selected a trigger', icon: Zap },
    [ClientToolCallState.error]: { text: 'Failed to select a trigger', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted selecting a trigger', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped selecting a trigger', icon: MinusCircle },
  },
  interrupt: undefined,
}

const META_get_user_workflow: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Reading your workflow', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Reading your workflow', icon: WorkflowIcon },
    [ClientToolCallState.executing]: { text: 'Reading your workflow', icon: Loader2 },
    [ClientToolCallState.aborted]: { text: 'Aborted reading your workflow', icon: XCircle },
    [ClientToolCallState.success]: { text: 'Read your workflow', icon: WorkflowIcon },
    [ClientToolCallState.error]: { text: 'Failed to read your workflow', icon: X },
    [ClientToolCallState.rejected]: { text: 'Skipped reading your workflow', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
    if (workflowId) {
      const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
      if (workflowName) {
        switch (state) {
          case ClientToolCallState.success:
            return `Read ${workflowName}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Reading ${workflowName}`
          case ClientToolCallState.error:
            return `Failed to read ${workflowName}`
          case ClientToolCallState.aborted:
            return `Aborted reading ${workflowName}`
          case ClientToolCallState.rejected:
            return `Skipped reading ${workflowName}`
        }
      }
    }
    return undefined
  },
}

const META_get_workflow_console: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Fetching execution logs', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Fetching execution logs', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Fetched execution logs', icon: TerminalSquare },
    [ClientToolCallState.error]: { text: 'Failed to fetch execution logs', icon: XCircle },
    [ClientToolCallState.rejected]: {
      text: 'Skipped fetching execution logs',
      icon: MinusCircle,
    },
    [ClientToolCallState.aborted]: {
      text: 'Aborted fetching execution logs',
      icon: MinusCircle,
    },
    [ClientToolCallState.pending]: { text: 'Fetching execution logs', icon: Loader2 },
  },
  getDynamicText: (params, state) => {
    const limit = params?.limit
    if (limit && typeof limit === 'number') {
      const logText = limit === 1 ? 'execution log' : 'execution logs'

      switch (state) {
        case ClientToolCallState.success:
          return `Fetched last ${limit} ${logText}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Fetching last ${limit} ${logText}`
        case ClientToolCallState.error:
          return `Failed to fetch last ${limit} ${logText}`
        case ClientToolCallState.rejected:
          return `Skipped fetching last ${limit} ${logText}`
        case ClientToolCallState.aborted:
          return `Aborted fetching last ${limit} ${logText}`
      }
    }
    return undefined
  },
}

const META_get_workflow_data: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Fetching workflow data', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Fetching workflow data', icon: Database },
    [ClientToolCallState.executing]: { text: 'Fetching workflow data', icon: Loader2 },
    [ClientToolCallState.aborted]: { text: 'Aborted fetching data', icon: XCircle },
    [ClientToolCallState.success]: { text: 'Retrieved workflow data', icon: Database },
    [ClientToolCallState.error]: { text: 'Failed to fetch data', icon: X },
    [ClientToolCallState.rejected]: { text: 'Skipped fetching data', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const dataType = params?.data_type as WorkflowDataType | undefined
    if (!dataType) return undefined

    const typeLabels: Record<WorkflowDataType, string> = {
      global_variables: 'variables',
      custom_tools: 'custom tools',
      mcp_tools: 'MCP tools',
      files: 'files',
    }

    const label = typeLabels[dataType] || dataType

    switch (state) {
      case ClientToolCallState.success:
        return `Retrieved ${label}`
      case ClientToolCallState.executing:
      case ClientToolCallState.generating:
        return `Fetching ${label}`
      case ClientToolCallState.pending:
        return `Fetch ${label}?`
      case ClientToolCallState.error:
        return `Failed to fetch ${label}`
      case ClientToolCallState.aborted:
        return `Aborted fetching ${label}`
      case ClientToolCallState.rejected:
        return `Skipped fetching ${label}`
    }
    return undefined
  },
}

const META_get_workflow_from_name: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Reading workflow', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Reading workflow', icon: FileText },
    [ClientToolCallState.executing]: { text: 'Reading workflow', icon: Loader2 },
    [ClientToolCallState.aborted]: { text: 'Aborted reading workflow', icon: XCircle },
    [ClientToolCallState.success]: { text: 'Read workflow', icon: FileText },
    [ClientToolCallState.error]: { text: 'Failed to read workflow', icon: X },
    [ClientToolCallState.rejected]: { text: 'Skipped reading workflow', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    if (params?.workflow_name && typeof params.workflow_name === 'string') {
      const workflowName = params.workflow_name

      switch (state) {
        case ClientToolCallState.success:
          return `Read ${workflowName}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Reading ${workflowName}`
        case ClientToolCallState.error:
          return `Failed to read ${workflowName}`
        case ClientToolCallState.aborted:
          return `Aborted reading ${workflowName}`
        case ClientToolCallState.rejected:
          return `Skipped reading ${workflowName}`
      }
    }
    return undefined
  },
}

const META_info: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Getting info', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Getting info', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Getting info', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Retrieved info', icon: Info },
    [ClientToolCallState.error]: { text: 'Failed to get info', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped info', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted info', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Getting info',
      completedLabel: 'Info retrieved',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_knowledge: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Managing knowledge', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Managing knowledge', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Managing knowledge', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Managed knowledge', icon: BookOpen },
    [ClientToolCallState.error]: { text: 'Failed to manage knowledge', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped knowledge', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted knowledge', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Managing knowledge',
      completedLabel: 'Knowledge managed',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_knowledge_base: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Accessing knowledge base', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Accessing knowledge base', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Accessing knowledge base', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Accessed knowledge base', icon: Database },
    [ClientToolCallState.error]: { text: 'Failed to access knowledge base', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted knowledge base access', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped knowledge base access', icon: MinusCircle },
  },
  getDynamicText: (params: Record<string, any>, state: ClientToolCallState) => {
    const operation = params?.operation as string | undefined
    const name = params?.args?.name as string | undefined

    const opVerbs: Record<string, { active: string; past: string; pending?: string }> = {
      create: {
        active: 'Creating knowledge base',
        past: 'Created knowledge base',
        pending: name ? `Create knowledge base "${name}"?` : 'Create knowledge base?',
      },
      list: { active: 'Listing knowledge bases', past: 'Listed knowledge bases' },
      get: { active: 'Getting knowledge base', past: 'Retrieved knowledge base' },
      query: { active: 'Querying knowledge base', past: 'Queried knowledge base' },
    }
    const defaultVerb: { active: string; past: string; pending?: string } = {
      active: 'Accessing knowledge base',
      past: 'Accessed knowledge base',
    }
    const verb = operation ? opVerbs[operation] || defaultVerb : defaultVerb

    if (state === ClientToolCallState.success) {
      return verb.past
    }
    if (state === ClientToolCallState.pending && verb.pending) {
      return verb.pending
    }
    if (
      state === ClientToolCallState.generating ||
      state === ClientToolCallState.pending ||
      state === ClientToolCallState.executing
    ) {
      return verb.active
    }
    return undefined
  },
}

const META_list_user_workflows: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Listing your workflows', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Listing your workflows', icon: ListChecks },
    [ClientToolCallState.executing]: { text: 'Listing your workflows', icon: Loader2 },
    [ClientToolCallState.aborted]: { text: 'Aborted listing workflows', icon: XCircle },
    [ClientToolCallState.success]: { text: 'Listed your workflows', icon: ListChecks },
    [ClientToolCallState.error]: { text: 'Failed to list workflows', icon: X },
    [ClientToolCallState.rejected]: { text: 'Skipped listing workflows', icon: XCircle },
  },
}

const META_list_workspace_mcp_servers: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Getting MCP servers',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Getting MCP servers', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Getting MCP servers', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Retrieved MCP servers', icon: Server },
    [ClientToolCallState.error]: { text: 'Failed to get MCP servers', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted getting MCP servers', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped getting MCP servers', icon: XCircle },
  },
  interrupt: undefined,
}

const META_make_api_request: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Preparing API request', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Review API request', icon: Globe2 },
    [ClientToolCallState.executing]: { text: 'Executing API request', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Completed API request', icon: Globe2 },
    [ClientToolCallState.error]: { text: 'Failed to execute API request', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped API request', icon: MinusCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted API request', icon: XCircle },
  },
  interrupt: {
    accept: { text: 'Execute', icon: Globe2 },
    reject: { text: 'Skip', icon: MinusCircle },
  },
  uiConfig: {
    interrupt: {
      accept: { text: 'Execute', icon: Globe2 },
      reject: { text: 'Skip', icon: MinusCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
    paramsTable: {
      columns: [
        { key: 'method', label: 'Method', width: '26%', editable: true, mono: true },
        { key: 'url', label: 'Endpoint', width: '74%', editable: true, mono: true },
      ],
      extractRows: (params: Record<string, any>): Array<[string, ...any[]]> => {
        return [['request', (params.method || 'GET').toUpperCase(), params.url || '']]
      },
    },
  },
  getDynamicText: (params, state) => {
    if (params?.url && typeof params.url === 'string') {
      const method = params.method || 'GET'
      let url = params.url

      // Extract domain from URL for cleaner display
      try {
        const urlObj = new URL(url)
        url = urlObj.hostname + urlObj.pathname
      } catch {
        // Use URL as-is if parsing fails
      }

      switch (state) {
        case ClientToolCallState.success:
          return `${method} ${url} complete`
        case ClientToolCallState.executing:
          return `${method} ${url}`
        case ClientToolCallState.generating:
          return `Preparing ${method} ${url}`
        case ClientToolCallState.pending:
          return `Review ${method} ${url}`
        case ClientToolCallState.error:
          return `Failed ${method} ${url}`
        case ClientToolCallState.rejected:
          return `Skipped ${method} ${url}`
        case ClientToolCallState.aborted:
          return `Aborted ${method} ${url}`
      }
    }
    return undefined
  },
}

const META_manage_custom_tool: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Managing custom tool',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Manage custom tool?', icon: Plus },
    [ClientToolCallState.executing]: { text: 'Managing custom tool', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Managed custom tool', icon: Check },
    [ClientToolCallState.error]: { text: 'Failed to manage custom tool', icon: X },
    [ClientToolCallState.aborted]: {
      text: 'Aborted managing custom tool',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped managing custom tool',
      icon: XCircle,
    },
  },
  interrupt: {
    accept: { text: 'Allow', icon: Check },
    reject: { text: 'Skip', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const operation = params?.operation as 'add' | 'edit' | 'delete' | 'list' | undefined

    if (!operation) return undefined

    let toolName = params?.schema?.function?.name
    if (!toolName && params?.toolId) {
      try {
        const tool = getCustomTool(params.toolId)
        toolName = tool?.schema?.function?.name
      } catch {
        // Ignore errors accessing cache
      }
    }

    const getActionText = (verb: 'present' | 'past' | 'gerund') => {
      switch (operation) {
        case 'add':
          return verb === 'present' ? 'Create' : verb === 'past' ? 'Created' : 'Creating'
        case 'edit':
          return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
        case 'delete':
          return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
        case 'list':
          return verb === 'present' ? 'List' : verb === 'past' ? 'Listed' : 'Listing'
        default:
          return verb === 'present' ? 'Manage' : verb === 'past' ? 'Managed' : 'Managing'
      }
    }

    // For add: only show tool name in past tense (success)
    // For edit/delete: always show tool name
    // For list: never show individual tool name, use plural
    const shouldShowToolName = (currentState: ClientToolCallState) => {
      if (operation === 'list') return false
      if (operation === 'add') {
        return currentState === ClientToolCallState.success
      }
      return true // edit and delete always show tool name
    }

    const nameText =
      operation === 'list'
        ? ' custom tools'
        : shouldShowToolName(state) && toolName
          ? ` ${toolName}`
          : ' custom tool'

    switch (state) {
      case ClientToolCallState.success:
        return `${getActionText('past')}${nameText}`
      case ClientToolCallState.executing:
        return `${getActionText('gerund')}${nameText}`
      case ClientToolCallState.generating:
        return `${getActionText('gerund')}${nameText}`
      case ClientToolCallState.pending:
        return `${getActionText('present')}${nameText}?`
      case ClientToolCallState.error:
        return `Failed to ${getActionText('present')?.toLowerCase()}${nameText}`
      case ClientToolCallState.aborted:
        return `Aborted ${getActionText('gerund')?.toLowerCase()}${nameText}`
      case ClientToolCallState.rejected:
        return `Skipped ${getActionText('gerund')?.toLowerCase()}${nameText}`
    }
    return undefined
  },
}

const META_manage_mcp_tool: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Managing MCP tool',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Manage MCP tool?', icon: Server },
    [ClientToolCallState.executing]: { text: 'Managing MCP tool', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Managed MCP tool', icon: Check },
    [ClientToolCallState.error]: { text: 'Failed to manage MCP tool', icon: X },
    [ClientToolCallState.aborted]: {
      text: 'Aborted managing MCP tool',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped managing MCP tool',
      icon: XCircle,
    },
  },
  interrupt: {
    accept: { text: 'Allow', icon: Check },
    reject: { text: 'Skip', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const operation = params?.operation as 'add' | 'edit' | 'delete' | undefined

    if (!operation) return undefined

    const serverName = params?.config?.name || params?.serverName

    const getActionText = (verb: 'present' | 'past' | 'gerund') => {
      switch (operation) {
        case 'add':
          return verb === 'present' ? 'Add' : verb === 'past' ? 'Added' : 'Adding'
        case 'edit':
          return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
        case 'delete':
          return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
      }
    }

    const shouldShowServerName = (currentState: ClientToolCallState) => {
      if (operation === 'add') {
        return currentState === ClientToolCallState.success
      }
      return true
    }

    const nameText = shouldShowServerName(state) && serverName ? ` ${serverName}` : ' MCP tool'

    switch (state) {
      case ClientToolCallState.success:
        return `${getActionText('past')}${nameText}`
      case ClientToolCallState.executing:
        return `${getActionText('gerund')}${nameText}`
      case ClientToolCallState.generating:
        return `${getActionText('gerund')}${nameText}`
      case ClientToolCallState.pending:
        return `${getActionText('present')}${nameText}?`
      case ClientToolCallState.error:
        return `Failed to ${getActionText('present')?.toLowerCase()}${nameText}`
      case ClientToolCallState.aborted:
        return `Aborted ${getActionText('gerund')?.toLowerCase()}${nameText}`
      case ClientToolCallState.rejected:
        return `Skipped ${getActionText('gerund')?.toLowerCase()}${nameText}`
    }
    return undefined
  },
}

const META_mark_todo_in_progress: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Marking todo in progress', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Marking todo in progress', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Marking todo in progress', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Marked todo in progress', icon: Loader2 },
    [ClientToolCallState.error]: { text: 'Failed to mark in progress', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted marking in progress', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped marking in progress', icon: MinusCircle },
  },
}

const META_navigate_ui: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to open',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Open?', icon: Navigation },
    [ClientToolCallState.executing]: { text: 'Opening', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Opened', icon: Navigation },
    [ClientToolCallState.error]: { text: 'Failed to open', icon: X },
    [ClientToolCallState.aborted]: {
      text: 'Aborted opening',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped opening',
      icon: XCircle,
    },
  },
  interrupt: {
    accept: { text: 'Open', icon: Navigation },
    reject: { text: 'Skip', icon: XCircle },
  },
  getDynamicText: (params, state) => {
    const destination = params?.destination as NavigationDestination | undefined
    const workflowName = params?.workflowName

    const action = 'open'
    const actionCapitalized = 'Open'
    const actionPast = 'opened'
    const actionIng = 'opening'
    let target = ''

    if (destination === 'workflow' && workflowName) {
      target = ` workflow "${workflowName}"`
    } else if (destination === 'workflow') {
      target = ' workflows'
    } else if (destination === 'logs') {
      target = ' logs'
    } else if (destination === 'templates') {
      target = ' templates'
    } else if (destination === 'vector_db') {
      target = ' vector database'
    } else if (destination === 'settings') {
      target = ' settings'
    }

    const fullAction = `${action}${target}`
    const fullActionCapitalized = `${actionCapitalized}${target}`
    const fullActionPast = `${actionPast}${target}`
    const fullActionIng = `${actionIng}${target}`

    switch (state) {
      case ClientToolCallState.success:
        return fullActionPast.charAt(0).toUpperCase() + fullActionPast.slice(1)
      case ClientToolCallState.executing:
        return fullActionIng.charAt(0).toUpperCase() + fullActionIng.slice(1)
      case ClientToolCallState.generating:
        return `Preparing to ${fullAction}`
      case ClientToolCallState.pending:
        return `${fullActionCapitalized}?`
      case ClientToolCallState.error:
        return `Failed to ${fullAction}`
      case ClientToolCallState.aborted:
        return `Aborted ${fullAction}`
      case ClientToolCallState.rejected:
        return `Skipped ${fullAction}`
    }
    return undefined
  },
}

const META_oauth_request_access: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Requesting integration access', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Requesting integration access', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Requesting integration access', icon: Loader2 },
    [ClientToolCallState.rejected]: { text: 'Skipped integration access', icon: MinusCircle },
    [ClientToolCallState.success]: { text: 'Requested integration access', icon: CheckCircle },
    [ClientToolCallState.error]: { text: 'Failed to request integration access', icon: X },
    [ClientToolCallState.aborted]: { text: 'Aborted integration access request', icon: XCircle },
  },
  interrupt: {
    accept: { text: 'Connect', icon: PlugZap },
    reject: { text: 'Skip', icon: MinusCircle },
  },
  getDynamicText: (params, state) => {
    if (params.providerName) {
      const name = params.providerName
      switch (state) {
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
        case ClientToolCallState.executing:
          return `Requesting ${name} access`
        case ClientToolCallState.rejected:
          return `Skipped ${name} access`
        case ClientToolCallState.success:
          return `Requested ${name} access`
        case ClientToolCallState.error:
          return `Failed to request ${name} access`
        case ClientToolCallState.aborted:
          return `Aborted ${name} access request`
      }
    }
    return undefined
  },
}

const META_plan: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Planning', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Planning', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Planning', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Planned', icon: ListTodo },
    [ClientToolCallState.error]: { text: 'Failed to plan', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped plan', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted plan', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Planning',
      completedLabel: 'Planned',
      shouldCollapse: true,
      outputArtifacts: ['plan'],
    },
  },
}

const META_redeploy: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Redeploying workflow', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Redeploy workflow', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Redeploying workflow', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Redeployed workflow', icon: Rocket },
    [ClientToolCallState.error]: { text: 'Failed to redeploy workflow', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted redeploy', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped redeploy', icon: XCircle },
  },
  interrupt: undefined,
}

const META_remember_debug: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Validating fix', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Validating fix', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Validating fix', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Validated fix', icon: CheckCircle2 },
    [ClientToolCallState.error]: { text: 'Failed to validate', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted validation', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped validation', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    const operation = params?.operation

    if (operation === 'add' || operation === 'edit') {
      // For add/edit, show from problem or solution
      const text = params?.problem || params?.solution
      if (text && typeof text === 'string') {
        switch (state) {
          case ClientToolCallState.success:
            return `Validated fix ${text}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Validating fix ${text}`
          case ClientToolCallState.error:
            return `Failed to validate fix ${text}`
          case ClientToolCallState.aborted:
            return `Aborted validating fix ${text}`
          case ClientToolCallState.rejected:
            return `Skipped validating fix ${text}`
        }
      }
    } else if (operation === 'delete') {
      // For delete, show from problem or solution (or id as fallback)
      const text = params?.problem || params?.solution || params?.id
      if (text && typeof text === 'string') {
        switch (state) {
          case ClientToolCallState.success:
            return `Adjusted fix ${text}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Adjusting fix ${text}`
          case ClientToolCallState.error:
            return `Failed to adjust fix ${text}`
          case ClientToolCallState.aborted:
            return `Aborted adjusting fix ${text}`
          case ClientToolCallState.rejected:
            return `Skipped adjusting fix ${text}`
        }
      }
    }

    return undefined
  },
}

const META_research: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Researching', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Researching', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Researching', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Researched', icon: Search },
    [ClientToolCallState.error]: { text: 'Failed to research', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped research', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted research', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Researching',
      completedLabel: 'Researched',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_run_workflow: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Preparing to run your workflow', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Run this workflow?', icon: Play },
    [ClientToolCallState.executing]: { text: 'Running your workflow', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Executed workflow', icon: Play },
    [ClientToolCallState.error]: { text: 'Errored running workflow', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped workflow execution', icon: MinusCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted workflow execution', icon: MinusCircle },
    [ClientToolCallState.background]: { text: 'Running in background', icon: Play },
  },
  interrupt: {
    accept: { text: 'Run', icon: Play },
    reject: { text: 'Skip', icon: MinusCircle },
  },
  uiConfig: {
    isSpecial: true,
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
    secondaryAction: {
      text: 'Move to Background',
      title: 'Move to Background',
      variant: 'tertiary',
      showInStates: [ClientToolCallState.executing],
      completionMessage:
        'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete',
      targetState: ClientToolCallState.background,
    },
    paramsTable: {
      columns: [
        { key: 'input', label: 'Input', width: '36%' },
        { key: 'value', label: 'Value', width: '64%', editable: true, mono: true },
      ],
      extractRows: (params: Record<string, any>): Array<[string, ...any[]]> => {
        let inputs = params.input || params.inputs || params.workflow_input
        if (typeof inputs === 'string') {
          try {
            inputs = JSON.parse(inputs)
          } catch {
            inputs = {}
          }
        }
        if (params.workflow_input && typeof params.workflow_input === 'object') {
          inputs = params.workflow_input
        }
        if (!inputs || typeof inputs !== 'object') {
          const { workflowId, workflow_input, ...rest } = params
          inputs = rest
        }
        const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
        return Object.entries(safeInputs).map(([key, value]) => [key, key, String(value)])
      },
    },
  },
  getDynamicText: (params, state) => {
    const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
    if (workflowId) {
      const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
      if (workflowName) {
        switch (state) {
          case ClientToolCallState.success:
            return `Ran ${workflowName}`
          case ClientToolCallState.executing:
            return `Running ${workflowName}`
          case ClientToolCallState.generating:
            return `Preparing to run ${workflowName}`
          case ClientToolCallState.pending:
            return `Run ${workflowName}?`
          case ClientToolCallState.error:
            return `Failed to run ${workflowName}`
          case ClientToolCallState.rejected:
            return `Skipped running ${workflowName}`
          case ClientToolCallState.aborted:
            return `Aborted running ${workflowName}`
          case ClientToolCallState.background:
            return `Running ${workflowName} in background`
        }
      }
    }
    return undefined
  },
}

const META_scrape_page: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Scraping page', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Scraping page', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Scraping page', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Scraped page', icon: Globe },
    [ClientToolCallState.error]: { text: 'Failed to scrape page', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted scraping page', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped scraping page', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.url && typeof params.url === 'string') {
      const url = params.url

      switch (state) {
        case ClientToolCallState.success:
          return `Scraped ${url}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Scraping ${url}`
        case ClientToolCallState.error:
          return `Failed to scrape ${url}`
        case ClientToolCallState.aborted:
          return `Aborted scraping ${url}`
        case ClientToolCallState.rejected:
          return `Skipped scraping ${url}`
      }
    }
    return undefined
  },
}

const META_search_documentation: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Searching documentation', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Searching documentation', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Searching documentation', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Completed documentation search', icon: BookOpen },
    [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
  },
  getDynamicText: (params, state) => {
    if (params?.query && typeof params.query === 'string') {
      const query = params.query

      switch (state) {
        case ClientToolCallState.success:
          return `Searched docs for ${query}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Searching docs for ${query}`
        case ClientToolCallState.error:
          return `Failed to search docs for ${query}`
        case ClientToolCallState.aborted:
          return `Aborted searching docs for ${query}`
        case ClientToolCallState.rejected:
          return `Skipped searching docs for ${query}`
      }
    }
    return undefined
  },
}

const META_search_errors: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Debugging', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Debugging', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Debugging', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Debugged', icon: Bug },
    [ClientToolCallState.error]: { text: 'Failed to debug', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted debugging', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped debugging', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.query && typeof params.query === 'string') {
      const query = params.query

      switch (state) {
        case ClientToolCallState.success:
          return `Debugged ${query}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Debugging ${query}`
        case ClientToolCallState.error:
          return `Failed to debug ${query}`
        case ClientToolCallState.aborted:
          return `Aborted debugging ${query}`
        case ClientToolCallState.rejected:
          return `Skipped debugging ${query}`
      }
    }
    return undefined
  },
}

const META_search_library_docs: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Reading docs', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Reading docs', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Reading docs', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Read docs', icon: BookOpen },
    [ClientToolCallState.error]: { text: 'Failed to read docs', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted reading docs', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped reading docs', icon: MinusCircle },
  },
  getDynamicText: (params, state) => {
    const libraryName = params?.library_name
    if (libraryName && typeof libraryName === 'string') {
      switch (state) {
        case ClientToolCallState.success:
          return `Read ${libraryName} docs`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Reading ${libraryName} docs`
        case ClientToolCallState.error:
          return `Failed to read ${libraryName} docs`
        case ClientToolCallState.aborted:
          return `Aborted reading ${libraryName} docs`
        case ClientToolCallState.rejected:
          return `Skipped reading ${libraryName} docs`
      }
    }
    return undefined
  },
}

const META_search_online: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Searching online', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Searching online', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Searching online', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Completed online search', icon: Globe },
    [ClientToolCallState.error]: { text: 'Failed to search online', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped online search', icon: MinusCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted online search', icon: XCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.query && typeof params.query === 'string') {
      const query = params.query

      switch (state) {
        case ClientToolCallState.success:
          return `Searched online for ${query}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Searching online for ${query}`
        case ClientToolCallState.error:
          return `Failed to search online for ${query}`
        case ClientToolCallState.aborted:
          return `Aborted searching online for ${query}`
        case ClientToolCallState.rejected:
          return `Skipped searching online for ${query}`
      }
    }
    return undefined
  },
}

const META_search_patterns: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Searching workflow patterns', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Searching workflow patterns', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Searching workflow patterns', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Found workflow patterns', icon: Search },
    [ClientToolCallState.error]: { text: 'Failed to search patterns', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted pattern search', icon: MinusCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped pattern search', icon: MinusCircle },
  },
  interrupt: undefined,
  getDynamicText: (params, state) => {
    if (params?.queries && Array.isArray(params.queries) && params.queries.length > 0) {
      const firstQuery = String(params.queries[0])

      switch (state) {
        case ClientToolCallState.success:
          return `Searched ${firstQuery}`
        case ClientToolCallState.executing:
        case ClientToolCallState.generating:
        case ClientToolCallState.pending:
          return `Searching ${firstQuery}`
        case ClientToolCallState.error:
          return `Failed to search ${firstQuery}`
        case ClientToolCallState.aborted:
          return `Aborted searching ${firstQuery}`
        case ClientToolCallState.rejected:
          return `Skipped searching ${firstQuery}`
      }
    }
    return undefined
  },
}

const META_set_environment_variables: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to set environment variables',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Set environment variables?', icon: Settings2 },
    [ClientToolCallState.executing]: { text: 'Setting environment variables', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Set environment variables', icon: Settings2 },
    [ClientToolCallState.error]: { text: 'Failed to set environment variables', icon: X },
    [ClientToolCallState.aborted]: {
      text: 'Aborted setting environment variables',
      icon: XCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped setting environment variables',
      icon: XCircle,
    },
  },
  interrupt: {
    accept: { text: 'Apply', icon: Settings2 },
    reject: { text: 'Skip', icon: XCircle },
  },
  uiConfig: {
    alwaysExpanded: true,
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
    paramsTable: {
      columns: [
        { key: 'name', label: 'Variable', width: '36%', editable: true },
        { key: 'value', label: 'Value', width: '64%', editable: true, mono: true },
      ],
      extractRows: (params: Record<string, any>): Array<[string, ...any[]]> => {
        const variables = params.variables || {}
        const entries = Array.isArray(variables)
          ? variables.map((v: any, i: number) => [String(i), v.name || `var_${i}`, v.value || ''])
          : Object.entries(variables).map(([key, val]) => {
              if (typeof val === 'object' && val !== null && 'value' in (val as any)) {
                return [key, key, (val as any).value]
              }
              return [key, key, val]
            })
        return entries as Array<[string, ...any[]]>
      },
    },
  },
  getDynamicText: (params, state) => {
    if (params?.variables && typeof params.variables === 'object') {
      const count = Object.keys(params.variables).length
      const varText = count === 1 ? 'variable' : 'variables'

      switch (state) {
        case ClientToolCallState.success:
          return `Set ${count} ${varText}`
        case ClientToolCallState.executing:
          return `Setting ${count} ${varText}`
        case ClientToolCallState.generating:
          return `Preparing to set ${count} ${varText}`
        case ClientToolCallState.pending:
          return `Set ${count} ${varText}?`
        case ClientToolCallState.error:
          return `Failed to set ${count} ${varText}`
        case ClientToolCallState.aborted:
          return `Aborted setting ${count} ${varText}`
        case ClientToolCallState.rejected:
          return `Skipped setting ${count} ${varText}`
      }
    }
    return undefined
  },
}

const META_set_global_workflow_variables: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: {
      text: 'Preparing to set workflow variables',
      icon: Loader2,
    },
    [ClientToolCallState.pending]: { text: 'Set workflow variables?', icon: Settings2 },
    [ClientToolCallState.executing]: { text: 'Setting workflow variables', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Updated workflow variables', icon: Settings2 },
    [ClientToolCallState.error]: { text: 'Failed to set workflow variables', icon: X },
    [ClientToolCallState.aborted]: { text: 'Aborted setting variables', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped setting variables', icon: XCircle },
  },
  interrupt: {
    accept: { text: 'Apply', icon: Settings2 },
    reject: { text: 'Skip', icon: XCircle },
  },
  uiConfig: {
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
      showAllowOnce: true,
      showAllowAlways: true,
    },
    paramsTable: {
      columns: [
        { key: 'name', label: 'Name', width: '40%', editable: true, mono: true },
        { key: 'value', label: 'Value', width: '60%', editable: true, mono: true },
      ],
      extractRows: (params: Record<string, any>): Array<[string, ...any[]]> => {
        const operations = params.operations || []
        return operations.map((op: any, idx: number) => [
          String(idx),
          op.name || '',
          String(op.value ?? ''),
        ])
      },
    },
  },
  getDynamicText: (params, state) => {
    if (params?.operations && Array.isArray(params.operations)) {
      const varNames = params.operations
        .slice(0, 2)
        .map((op: any) => op.name)
        .filter(Boolean)

      if (varNames.length > 0) {
        const varList = varNames.join(', ')
        const more = params.operations.length > 2 ? '...' : ''
        const displayText = `${varList}${more}`

        switch (state) {
          case ClientToolCallState.success:
            return `Set ${displayText}`
          case ClientToolCallState.executing:
            return `Setting ${displayText}`
          case ClientToolCallState.generating:
            return `Preparing to set ${displayText}`
          case ClientToolCallState.pending:
            return `Set ${displayText}?`
          case ClientToolCallState.error:
            return `Failed to set ${displayText}`
          case ClientToolCallState.aborted:
            return `Aborted setting ${displayText}`
          case ClientToolCallState.rejected:
            return `Skipped setting ${displayText}`
        }
      }
    }
    return undefined
  },
}

const META_sleep: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Preparing to sleep', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Sleeping', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Sleeping', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Finished sleeping', icon: Moon },
    [ClientToolCallState.error]: { text: 'Interrupted sleep', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped sleep', icon: MinusCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted sleep', icon: MinusCircle },
    [ClientToolCallState.background]: { text: 'Resumed', icon: Moon },
  },
  uiConfig: {
    secondaryAction: {
      text: 'Wake',
      title: 'Wake',
      variant: 'tertiary',
      showInStates: [ClientToolCallState.executing],
      targetState: ClientToolCallState.background,
    },
  },
  // No interrupt - auto-execute immediately
  getDynamicText: (params, state) => {
    const seconds = params?.seconds
    if (typeof seconds === 'number' && seconds > 0) {
      const displayTime = formatDuration(seconds)
      switch (state) {
        case ClientToolCallState.success:
          return `Slept for ${displayTime}`
        case ClientToolCallState.executing:
        case ClientToolCallState.pending:
          return `Sleeping for ${displayTime}`
        case ClientToolCallState.generating:
          return `Preparing to sleep for ${displayTime}`
        case ClientToolCallState.error:
          return `Failed to sleep for ${displayTime}`
        case ClientToolCallState.rejected:
          return `Skipped sleeping for ${displayTime}`
        case ClientToolCallState.aborted:
          return `Aborted sleeping for ${displayTime}`
        case ClientToolCallState.background: {
          // Calculate elapsed time from when sleep started
          const elapsedSeconds = params?._elapsedSeconds
          if (typeof elapsedSeconds === 'number' && elapsedSeconds > 0) {
            return `Resumed after ${formatDuration(Math.round(elapsedSeconds))}`
          }
          return 'Resumed early'
        }
      }
    }
    return undefined
  },
}

const META_summarize_conversation: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Summarizing conversation', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Summarizing conversation', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Summarizing conversation', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Summarized conversation', icon: PencilLine },
    [ClientToolCallState.error]: { text: 'Failed to summarize conversation', icon: XCircle },
    [ClientToolCallState.aborted]: {
      text: 'Aborted summarizing conversation',
      icon: MinusCircle,
    },
    [ClientToolCallState.rejected]: {
      text: 'Skipped summarizing conversation',
      icon: MinusCircle,
    },
  },
  interrupt: undefined,
}

const META_superagent: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Superagent working', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Superagent working', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Superagent working', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Superagent completed', icon: Sparkles },
    [ClientToolCallState.error]: { text: 'Superagent failed', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Superagent skipped', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Superagent aborted', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Superagent working',
      completedLabel: 'Superagent completed',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_test: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Testing', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Testing', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Testing', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Tested', icon: FlaskConical },
    [ClientToolCallState.error]: { text: 'Failed to test', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped test', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted test', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Testing',
      completedLabel: 'Tested',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_tour: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Touring', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Touring', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Touring', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Completed tour', icon: Compass },
    [ClientToolCallState.error]: { text: 'Failed tour', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped tour', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted tour', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Touring',
      completedLabel: 'Tour complete',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const META_workflow: ToolMetadata = {
  displayNames: {
    [ClientToolCallState.generating]: { text: 'Managing workflow', icon: Loader2 },
    [ClientToolCallState.pending]: { text: 'Managing workflow', icon: Loader2 },
    [ClientToolCallState.executing]: { text: 'Managing workflow', icon: Loader2 },
    [ClientToolCallState.success]: { text: 'Managed workflow', icon: GitBranch },
    [ClientToolCallState.error]: { text: 'Failed to manage workflow', icon: XCircle },
    [ClientToolCallState.rejected]: { text: 'Skipped workflow', icon: XCircle },
    [ClientToolCallState.aborted]: { text: 'Aborted workflow', icon: XCircle },
  },
  uiConfig: {
    subagent: {
      streamingLabel: 'Managing workflow',
      completedLabel: 'Workflow managed',
      shouldCollapse: true,
      outputArtifacts: [],
    },
  },
}

const TOOL_METADATA_BY_ID: Record<string, ToolMetadata> = {
  auth: META_auth,
  check_deployment_status: META_check_deployment_status,
  checkoff_todo: META_checkoff_todo,
  crawl_website: META_crawl_website,
  create_workspace_mcp_server: META_create_workspace_mcp_server,
  custom_tool: META_custom_tool,
  debug: META_debug,
  deploy: META_deploy,
  deploy_api: META_deploy_api,
  deploy_chat: META_deploy_chat,
  deploy_mcp: META_deploy_mcp,
  edit: META_edit,
  edit_workflow: META_edit_workflow,
  evaluate: META_evaluate,
  get_block_config: META_get_block_config,
  get_block_options: META_get_block_options,
  get_block_outputs: META_get_block_outputs,
  get_block_upstream_references: META_get_block_upstream_references,
  get_blocks_and_tools: META_get_blocks_and_tools,
  get_blocks_metadata: META_get_blocks_metadata,
  get_credentials: META_get_credentials,
  get_examples_rag: META_get_examples_rag,
  get_operations_examples: META_get_operations_examples,
  get_page_contents: META_get_page_contents,
  get_trigger_blocks: META_get_trigger_blocks,
  get_trigger_examples: META_get_trigger_examples,
  get_user_workflow: META_get_user_workflow,
  get_workflow_console: META_get_workflow_console,
  get_workflow_data: META_get_workflow_data,
  get_workflow_from_name: META_get_workflow_from_name,
  info: META_info,
  knowledge: META_knowledge,
  knowledge_base: META_knowledge_base,
  list_user_workflows: META_list_user_workflows,
  list_workspace_mcp_servers: META_list_workspace_mcp_servers,
  make_api_request: META_make_api_request,
  manage_custom_tool: META_manage_custom_tool,
  manage_mcp_tool: META_manage_mcp_tool,
  mark_todo_in_progress: META_mark_todo_in_progress,
  navigate_ui: META_navigate_ui,
  oauth_request_access: META_oauth_request_access,
  plan: META_plan,
  redeploy: META_redeploy,
  remember_debug: META_remember_debug,
  research: META_research,
  run_workflow: META_run_workflow,
  scrape_page: META_scrape_page,
  search_documentation: META_search_documentation,
  search_errors: META_search_errors,
  search_library_docs: META_search_library_docs,
  search_online: META_search_online,
  search_patterns: META_search_patterns,
  set_environment_variables: META_set_environment_variables,
  set_global_workflow_variables: META_set_global_workflow_variables,
  sleep: META_sleep,
  summarize_conversation: META_summarize_conversation,
  superagent: META_superagent,
  test: META_test,
  tour: META_tour,
  workflow: META_workflow,
}

export const TOOL_DISPLAY_REGISTRY: Record<string, ToolDisplayEntry> = Object.fromEntries(
  Object.entries(TOOL_METADATA_BY_ID).map(([toolName, metadata]) => [
    toolName,
    toToolDisplayEntry(metadata),
  ])
)
