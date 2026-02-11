import type { ChatContext } from '@/stores/panel'

/**
 * Mention folder types
 */
export type MentionFolderId =
  | 'chats'
  | 'workflows'
  | 'knowledge'
  | 'blocks'
  | 'workflow-blocks'
  | 'templates'
  | 'logs'

/**
 * Menu item category types for mention menu (includes folders + docs item)
 */
export type MentionCategory = MentionFolderId | 'docs'

/**
 * Configuration interface for folder types
 */
export interface FolderConfig<TItem = any> {
  /** Display title in menu */
  title: string
  /** Data source key in useMentionData return */
  dataKey: string
  /** Loading state key in useMentionData return */
  loadingKey: string
  /** Ensure loaded function key in useMentionData return (optional - some folders auto-load) */
  ensureLoadedKey?: string
  /** Extract label from an item */
  getLabel: (item: TItem) => string
  /** Extract unique ID from an item */
  getId: (item: TItem) => string
  /** Empty state message */
  emptyMessage: string
  /** No match message (when filtering) */
  noMatchMessage: string
  /** Filter function for matching query */
  filterFn: (item: TItem, query: string) => boolean
  /** Build the ChatContext object from an item */
  buildContext: (item: TItem, workflowId?: string | null) => ChatContext
  /** Whether to use insertAtCursor fallback when replaceActiveMentionWith fails */
  useInsertFallback?: boolean
}

/**
 * Configuration for all folder types in the mention menu
 */
export const FOLDER_CONFIGS: Record<MentionFolderId, FolderConfig> = {
  chats: {
    title: 'Chats',
    dataKey: 'pastChats',
    loadingKey: 'isLoadingPastChats',
    ensureLoadedKey: 'ensurePastChatsLoaded',
    getLabel: (item) => item.title || 'New Chat',
    getId: (item) => item.id,
    emptyMessage: 'No past chats',
    noMatchMessage: 'No matching chats',
    filterFn: (item, q) => (item.title || 'New Chat').toLowerCase().includes(q),
    buildContext: (item) => ({
      kind: 'past_chat',
      chatId: item.id,
      label: item.title || 'New Chat',
    }),
    useInsertFallback: false,
  },
  workflows: {
    title: 'All workflows',
    dataKey: 'workflows',
    loadingKey: 'isLoadingWorkflows',
    // No ensureLoadedKey - workflows auto-load from registry store
    getLabel: (item) => item.name || 'Untitled Workflow',
    getId: (item) => item.id,
    emptyMessage: 'No workflows',
    noMatchMessage: 'No matching workflows',
    filterFn: (item, q) => (item.name || 'Untitled Workflow').toLowerCase().includes(q),
    buildContext: (item) => ({
      kind: 'workflow',
      workflowId: item.id,
      label: item.name || 'Untitled Workflow',
    }),
    useInsertFallback: true,
  },
  knowledge: {
    title: 'Knowledge Bases',
    dataKey: 'knowledgeBases',
    loadingKey: 'isLoadingKnowledge',
    ensureLoadedKey: 'ensureKnowledgeLoaded',
    getLabel: (item) => item.name || 'Untitled',
    getId: (item) => item.id,
    emptyMessage: 'No knowledge bases',
    noMatchMessage: 'No matching knowledge bases',
    filterFn: (item, q) => (item.name || 'Untitled').toLowerCase().includes(q),
    buildContext: (item) => ({
      kind: 'knowledge',
      knowledgeId: item.id,
      label: item.name || 'Untitled',
    }),
    useInsertFallback: false,
  },
  blocks: {
    title: 'Blocks',
    dataKey: 'blocksList',
    loadingKey: 'isLoadingBlocks',
    ensureLoadedKey: 'ensureBlocksLoaded',
    getLabel: (item) => item.name || item.id,
    getId: (item) => item.id,
    emptyMessage: 'No blocks found',
    noMatchMessage: 'No matching blocks',
    filterFn: (item, q) => (item.name || item.id).toLowerCase().includes(q),
    buildContext: (item) => ({
      kind: 'blocks',
      blockIds: [item.id],
      label: item.name || item.id,
    }),
    useInsertFallback: false,
  },
  'workflow-blocks': {
    title: 'Workflow Blocks',
    dataKey: 'workflowBlocks',
    loadingKey: 'isLoadingWorkflowBlocks',
    // No ensureLoadedKey - workflow blocks auto-sync from store
    getLabel: (item) => item.name || item.id,
    getId: (item) => item.id,
    emptyMessage: 'No blocks in this workflow',
    noMatchMessage: 'No matching blocks',
    filterFn: (item, q) => (item.name || item.id).toLowerCase().includes(q),
    buildContext: (item, workflowId) => ({
      kind: 'workflow_block',
      workflowId: workflowId || '',
      blockId: item.id,
      label: item.name || item.id,
    }),
    useInsertFallback: true,
  },
  templates: {
    title: 'Templates',
    dataKey: 'templatesList',
    loadingKey: 'isLoadingTemplates',
    ensureLoadedKey: 'ensureTemplatesLoaded',
    getLabel: (item) => item.name || 'Untitled Template',
    getId: (item) => item.id,
    emptyMessage: 'No templates found',
    noMatchMessage: 'No matching templates',
    filterFn: (item, q) => (item.name || 'Untitled Template').toLowerCase().includes(q),
    buildContext: (item) => ({
      kind: 'templates',
      templateId: item.id,
      label: item.name || 'Untitled Template',
    }),
    useInsertFallback: false,
  },
  logs: {
    title: 'Logs',
    dataKey: 'logsList',
    loadingKey: 'isLoadingLogs',
    ensureLoadedKey: 'ensureLogsLoaded',
    getLabel: (item) => item.workflowName,
    getId: (item) => item.id,
    emptyMessage: 'No executions found',
    noMatchMessage: 'No matching executions',
    filterFn: (item, q) =>
      [item.workflowName, item.trigger || ''].join(' ').toLowerCase().includes(q),
    buildContext: (item) => ({
      kind: 'logs',
      executionId: item.executionId || item.id,
      label: item.workflowName,
    }),
    useInsertFallback: false,
  },
}

/**
 * Order of folders in the mention menu
 */
export const FOLDER_ORDER: MentionFolderId[] = [
  'chats',
  'workflows',
  'knowledge',
  'blocks',
  'workflow-blocks',
  'templates',
  'logs',
]

/**
 * Docs item configuration (special case - not a folder)
 */
export const DOCS_CONFIG = {
  getLabel: () => 'Docs',
  buildContext: (): ChatContext => ({ kind: 'docs', label: 'Docs' }),
} as const

/**
 * Total number of items in root menu (folders + docs)
 */
export const ROOT_MENU_ITEM_COUNT = FOLDER_ORDER.length + 1

/**
 * Slash command configuration
 */
export interface SlashCommand {
  id: string
  label: string
}

export const TOP_LEVEL_COMMANDS: readonly SlashCommand[] = [
  { id: 'fast', label: 'Fast' },
  { id: 'research', label: 'Research' },
  { id: 'actions', label: 'Actions' },
] as const

/**
 * Maps UI command IDs to API command IDs.
 * Some commands have different IDs for display vs API (e.g., "actions" -> "superagent")
 */
export function getApiCommandId(uiCommandId: string): string {
  const commandMapping: Record<string, string> = {
    actions: 'superagent',
  }
  return commandMapping[uiCommandId] || uiCommandId
}

export const WEB_COMMANDS: readonly SlashCommand[] = [
  { id: 'search', label: 'Search' },
  { id: 'read', label: 'Read' },
  { id: 'scrape', label: 'Scrape' },
  { id: 'crawl', label: 'Crawl' },
] as const

export const ALL_SLASH_COMMANDS: readonly SlashCommand[] = [...TOP_LEVEL_COMMANDS, ...WEB_COMMANDS]

export const ALL_COMMAND_IDS = ALL_SLASH_COMMANDS.map((cmd) => cmd.id)

/**
 * Get display label for a command ID
 */
export function getCommandDisplayLabel(commandId: string): string {
  const command = ALL_SLASH_COMMANDS.find((cmd) => cmd.id === commandId)
  return command?.label || commandId.charAt(0).toUpperCase() + commandId.slice(1)
}

/**
 * Model configuration options
 */
export const MODEL_OPTIONS = [
  { value: 'claude-4.5-opus', label: 'Claude 4.5 Opus' },
  { value: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet' },
  { value: 'claude-4.5-haiku', label: 'Claude 4.5 Haiku' },
  { value: 'gpt-5.2-codex', label: 'GPT 5.2 Codex' },
  { value: 'gpt-5.2-pro', label: 'GPT 5.2 Pro' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
] as const

/**
 * Threshold for considering input "near top" of viewport (in pixels)
 */
export const NEAR_TOP_THRESHOLD = 300

/**
 * Scroll tolerance for mention menu positioning (in pixels)
 */
export const SCROLL_TOLERANCE = 8

/**
 * Shared CSS classes for menu state text (loading, empty states)
 */
export const MENU_STATE_TEXT_CLASSES = 'px-[8px] py-[8px] text-[12px] text-[var(--text-muted)]'

/**
 * Calculates the next index for circular navigation (wraps around at bounds)
 */
export function getNextIndex(current: number, direction: 'up' | 'down', maxIndex: number): number {
  if (direction === 'down') {
    return current >= maxIndex ? 0 : current + 1
  }
  return current <= 0 ? maxIndex : current - 1
}
