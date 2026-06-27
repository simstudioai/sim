import { ObsidianIcon } from '@/components/icons'
import { ObsidianBlockDisplay } from '@/blocks/blocks/obsidian.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const ObsidianBlock: BlockConfig = {
  ...ObsidianBlockDisplay,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Files', id: 'list_files' },
        { label: 'Get Note', id: 'get_note' },
        { label: 'Create Note', id: 'create_note' },
        { label: 'Append to Note', id: 'append_note' },
        { label: 'Patch Note', id: 'patch_note' },
        { label: 'Delete Note', id: 'delete_note' },
        { label: 'Search', id: 'search' },
        { label: 'Get Active File', id: 'get_active' },
        { label: 'Append to Active File', id: 'append_active' },
        { label: 'Patch Active File', id: 'patch_active' },
        { label: 'Open File', id: 'open_file' },
        { label: 'List Commands', id: 'list_commands' },
        { label: 'Execute Command', id: 'execute_command' },
        { label: 'Get Periodic Note', id: 'get_periodic_note' },
        { label: 'Append to Periodic Note', id: 'append_periodic_note' },
      ],
      value: () => 'get_note',
    },
    {
      id: 'baseUrl',
      title: 'Base URL',
      type: 'short-input',
      placeholder: 'https://127.0.0.1:27124',
      value: () => 'https://127.0.0.1:27124',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Obsidian Local REST API key',
      password: true,
      required: true,
    },
    {
      id: 'path',
      title: 'Directory Path',
      type: 'short-input',
      placeholder: 'Leave empty for vault root (e.g. "Projects/notes")',
      condition: { field: 'operation', value: 'list_files' },
    },
    {
      id: 'filename',
      title: 'Note Path',
      type: 'short-input',
      placeholder: 'folder/note.md',
      condition: {
        field: 'operation',
        value: ['get_note', 'create_note', 'append_note', 'patch_note', 'delete_note', 'open_file'],
      },
      required: {
        field: 'operation',
        value: ['get_note', 'create_note', 'append_note', 'patch_note', 'delete_note', 'open_file'],
      },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Markdown content',
      condition: {
        field: 'operation',
        value: [
          'create_note',
          'append_note',
          'patch_note',
          'append_active',
          'patch_active',
          'append_periodic_note',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'create_note',
          'append_note',
          'patch_note',
          'append_active',
          'patch_active',
          'append_periodic_note',
        ],
      },
    },
    {
      id: 'patchOperation',
      title: 'Patch Operation',
      type: 'dropdown',
      options: [
        { label: 'Append', id: 'append' },
        { label: 'Prepend', id: 'prepend' },
        { label: 'Replace', id: 'replace' },
      ],
      value: () => 'append',
      condition: { field: 'operation', value: ['patch_note', 'patch_active'] },
      required: { field: 'operation', value: ['patch_note', 'patch_active'] },
    },
    {
      id: 'targetType',
      title: 'Target Type',
      type: 'dropdown',
      options: [
        { label: 'Heading', id: 'heading' },
        { label: 'Block Reference', id: 'block' },
        { label: 'Frontmatter', id: 'frontmatter' },
      ],
      value: () => 'heading',
      condition: { field: 'operation', value: ['patch_note', 'patch_active'] },
      required: { field: 'operation', value: ['patch_note', 'patch_active'] },
    },
    {
      id: 'target',
      title: 'Target',
      type: 'short-input',
      placeholder: 'Heading text, block ID, or frontmatter field',
      condition: { field: 'operation', value: ['patch_note', 'patch_active'] },
      required: { field: 'operation', value: ['patch_note', 'patch_active'] },
    },
    {
      id: 'targetDelimiter',
      title: 'Target Delimiter',
      type: 'short-input',
      placeholder: ':: (default)',
      condition: { field: 'operation', value: ['patch_note', 'patch_active'] },
      mode: 'advanced',
    },
    {
      id: 'trimTargetWhitespace',
      title: 'Trim Target Whitespace',
      type: 'switch',
      condition: { field: 'operation', value: ['patch_note', 'patch_active'] },
      mode: 'advanced',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Text to search for',
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
    },
    {
      id: 'contextLength',
      title: 'Context Length',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'commandId',
      title: 'Command ID',
      type: 'short-input',
      placeholder: 'e.g. daily-notes:open-today',
      condition: { field: 'operation', value: 'execute_command' },
      required: { field: 'operation', value: 'execute_command' },
    },
    {
      id: 'newLeaf',
      title: 'Open in New Tab',
      type: 'switch',
      condition: { field: 'operation', value: 'open_file' },
      mode: 'advanced',
    },
    {
      id: 'period',
      title: 'Period',
      type: 'dropdown',
      options: [
        { label: 'Daily', id: 'daily' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Monthly', id: 'monthly' },
        { label: 'Quarterly', id: 'quarterly' },
        { label: 'Yearly', id: 'yearly' },
      ],
      value: () => 'daily',
      condition: { field: 'operation', value: ['get_periodic_note', 'append_periodic_note'] },
      required: { field: 'operation', value: ['get_periodic_note', 'append_periodic_note'] },
    },
  ],

  tools: {
    access: [
      'obsidian_append_active',
      'obsidian_append_note',
      'obsidian_append_periodic_note',
      'obsidian_create_note',
      'obsidian_delete_note',
      'obsidian_execute_command',
      'obsidian_get_active',
      'obsidian_get_note',
      'obsidian_get_periodic_note',
      'obsidian_list_commands',
      'obsidian_list_files',
      'obsidian_open_file',
      'obsidian_patch_active',
      'obsidian_patch_note',
      'obsidian_search',
    ],
    config: {
      tool: (params) => `obsidian_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.contextLength) {
          result.contextLength = Number(params.contextLength)
        }
        if (params.patchOperation) {
          result.operation = params.patchOperation
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    baseUrl: { type: 'string', description: 'Base URL for the Obsidian Local REST API' },
    apiKey: { type: 'string', description: 'API key for authentication' },
    filename: { type: 'string', description: 'Path to the note relative to vault root' },
    content: { type: 'string', description: 'Markdown content for the note' },
    path: { type: 'string', description: 'Directory path to list' },
    query: { type: 'string', description: 'Text to search for' },
    contextLength: { type: 'number', description: 'Characters of context around matches' },
    commandId: { type: 'string', description: 'ID of the command to execute' },
    patchOperation: { type: 'string', description: 'Patch operation: append, prepend, or replace' },
    targetType: { type: 'string', description: 'Target type: heading, block, or frontmatter' },
    target: { type: 'string', description: 'Target identifier for patch operations' },
    targetDelimiter: { type: 'string', description: 'Delimiter for nested headings' },
    trimTargetWhitespace: { type: 'boolean', description: 'Trim whitespace from target' },
    newLeaf: { type: 'boolean', description: 'Open file in new tab' },
    period: { type: 'string', description: 'Periodic note period type' },
  },

  outputs: {
    content: { type: 'string', description: 'Markdown content of the note' },
    filename: { type: 'string', description: 'Path to the note' },
    files: { type: 'json', description: 'List of files and directories (path, type)' },
    results: { type: 'json', description: 'Search results (filename, score, matches)' },
    commands: { type: 'json', description: 'List of available commands (id, name)' },
    created: { type: 'boolean', description: 'Whether the note was created' },
    appended: { type: 'boolean', description: 'Whether content was appended' },
    patched: { type: 'boolean', description: 'Whether content was patched' },
    deleted: { type: 'boolean', description: 'Whether the note was deleted' },
    executed: { type: 'boolean', description: 'Whether the command was executed' },
    opened: { type: 'boolean', description: 'Whether the file was opened' },
    commandId: { type: 'string', description: 'ID of the executed command' },
    period: { type: 'string', description: 'Period type of the periodic note' },
  },
}

export const ObsidianBlockMeta = {
  tags: ['note-taking', 'knowledge-base'],
  url: 'https://obsidian.md',
  templates: [
    {
      icon: ObsidianIcon,
      title: 'Obsidian daily journal agent',
      prompt:
        'Build a workflow that pulls calendar events, completed tasks, and journal prompts, and generates a daily Obsidian note draft for the user to review and annotate.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'content'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian backlink builder',
      prompt:
        'Create a workflow that processes new Obsidian notes, identifies entities and concepts that should be wikilinks, and rewrites the note with proper backlinks plus a hub note for new tags.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian web clipper',
      prompt:
        'Build a workflow that accepts a URL from a form, scrapes the page with Firecrawl, summarizes with an agent, and writes the clip as a new Obsidian note with source metadata.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
      alsoIntegrations: ['firecrawl'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian knowledge-base sync',
      prompt:
        'Create a workflow that mirrors an Obsidian vault into a Sim knowledge base so an agent can answer questions over personal notes with citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian smart review',
      prompt:
        'Build a scheduled weekly workflow that surfaces stale Obsidian notes due for spaced-repetition review, scores their freshness, and writes a review queue note for the user.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian meeting-note autopopulator',
      prompt:
        'Create a workflow that runs after a Google Meet meeting, fetches the transcript, and appends a structured meeting note to an Obsidian vault under the right project folder.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'team'],
      alsoIntegrations: ['google_meet'],
    },
    {
      icon: ObsidianIcon,
      title: 'Obsidian reading-list digester',
      prompt:
        'Build a scheduled workflow that reads the links saved in an Obsidian "to read" note, summarizes each article with an agent, and appends the key takeaways back into the vault as individual literature notes with source links.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'automation'],
    },
  ],
  skills: [
    {
      name: 'capture-note',
      description: 'Create a new Obsidian note with Markdown content at a chosen vault path.',
      content:
        '# Capture Note\n\nWrite a new note into the Obsidian vault.\n\n## Steps\n1. Decide the vault path and filename for the note, keeping folder conventions consistent.\n2. Compose the Markdown body with a clear title heading and any tags or frontmatter wanted.\n3. Run Create Note with the path and content. If the note may already exist, use Append to Note instead to avoid overwriting.\n\n## Output\nConfirm the note path created and summarize what was captured.',
    },
    {
      name: 'append-to-daily-note',
      description: 'Append an entry to the Obsidian periodic daily note.',
      content:
        '# Append to Daily Note\n\nAdd a timestamped entry to the current daily note.\n\n## Steps\n1. Use Get Periodic Note to confirm the daily note exists and read its current content if needed.\n2. Format the entry as a Markdown bullet or section, including a timestamp where useful.\n3. Run Append to Periodic Note to add it to the day.\n\n## Output\nConfirm the entry was appended to the daily note and quote the line added.',
    },
    {
      name: 'search-vault',
      description: 'Search the Obsidian vault for notes matching a query and summarize matches.',
      content:
        '# Search Vault\n\nFind notes in the Obsidian vault that mention a topic.\n\n## Steps\n1. Run Search with the query terms.\n2. Open the most relevant results with Get Note to read their content.\n3. Summarize the findings, linking each note by its path.\n\n## Output\nA short synthesis of what the vault says about the topic, with the source note paths listed.',
    },
  ],
} as const satisfies BlockMeta
