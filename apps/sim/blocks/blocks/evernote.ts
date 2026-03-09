import { EvernoteIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const EvernoteBlock: BlockConfig = {
  type: 'evernote',
  name: 'Evernote',
  description: 'Manage notes, notebooks, and tags in Evernote',
  longDescription:
    'Integrate with Evernote to manage notes, notebooks, and tags. Create, read, update, copy, search, and delete notes. Create and list notebooks and tags.',
  docsLink: 'https://docs.sim.ai/tools/evernote',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: EvernoteIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Note', id: 'create_note' },
        { label: 'Get Note', id: 'get_note' },
        { label: 'Update Note', id: 'update_note' },
        { label: 'Delete Note', id: 'delete_note' },
        { label: 'Copy Note', id: 'copy_note' },
        { label: 'Search Notes', id: 'search_notes' },
        { label: 'Get Notebook', id: 'get_notebook' },
        { label: 'Create Notebook', id: 'create_notebook' },
        { label: 'List Notebooks', id: 'list_notebooks' },
        { label: 'Create Tag', id: 'create_tag' },
        { label: 'List Tags', id: 'list_tags' },
      ],
      value: () => 'create_note',
    },
    {
      id: 'apiKey',
      title: 'Developer Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Evernote developer token',
      required: true,
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Note title',
      condition: { field: 'operation', value: 'create_note' },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Note content (plain text or ENML)',
      condition: { field: 'operation', value: 'create_note' },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteGuid',
      title: 'Note GUID',
      type: 'short-input',
      placeholder: 'Enter the note GUID',
      condition: {
        field: 'operation',
        value: ['get_note', 'update_note', 'delete_note', 'copy_note'],
      },
      required: {
        field: 'operation',
        value: ['get_note', 'update_note', 'delete_note', 'copy_note'],
      },
    },
    {
      id: 'updateTitle',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'New title (leave empty to keep current)',
      condition: { field: 'operation', value: 'update_note' },
    },
    {
      id: 'updateContent',
      title: 'New Content',
      type: 'long-input',
      placeholder: 'New content (leave empty to keep current)',
      condition: { field: 'operation', value: 'update_note' },
    },
    {
      id: 'toNotebookGuid',
      title: 'Destination Notebook GUID',
      type: 'short-input',
      placeholder: 'GUID of the destination notebook',
      condition: { field: 'operation', value: 'copy_note' },
      required: { field: 'operation', value: 'copy_note' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., "tag:work intitle:meeting"',
      condition: { field: 'operation', value: 'search_notes' },
      required: { field: 'operation', value: 'search_notes' },
    },
    {
      id: 'notebookGuid',
      title: 'Notebook GUID',
      type: 'short-input',
      placeholder: 'Notebook GUID',
      condition: {
        field: 'operation',
        value: ['create_note', 'update_note', 'search_notes', 'get_notebook'],
      },
      required: { field: 'operation', value: 'get_notebook' },
    },
    {
      id: 'notebookName',
      title: 'Notebook Name',
      type: 'short-input',
      placeholder: 'Name for the new notebook',
      condition: { field: 'operation', value: 'create_notebook' },
      required: { field: 'operation', value: 'create_notebook' },
    },
    {
      id: 'stack',
      title: 'Stack',
      type: 'short-input',
      placeholder: 'Stack name (optional)',
      condition: { field: 'operation', value: 'create_notebook' },
      mode: 'advanced',
    },
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'Name for the new tag',
      condition: { field: 'operation', value: 'create_tag' },
      required: { field: 'operation', value: 'create_tag' },
    },
    {
      id: 'parentGuid',
      title: 'Parent Tag GUID',
      type: 'short-input',
      placeholder: 'Parent tag GUID (optional)',
      condition: { field: 'operation', value: 'create_tag' },
      mode: 'advanced',
    },
    {
      id: 'tagNames',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags (e.g., "work, meeting, urgent")',
      condition: { field: 'operation', value: ['create_note', 'update_note'] },
      mode: 'advanced',
    },
    {
      id: 'maxNotes',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'search_notes' },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'search_notes' },
      mode: 'advanced',
    },
    {
      id: 'withContent',
      title: 'Include Content',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'get_note' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'evernote_copy_note',
      'evernote_create_note',
      'evernote_create_notebook',
      'evernote_create_tag',
      'evernote_delete_note',
      'evernote_get_note',
      'evernote_get_notebook',
      'evernote_list_notebooks',
      'evernote_list_tags',
      'evernote_search_notes',
      'evernote_update_note',
    ],
    config: {
      tool: (params) => `evernote_${params.operation}`,
      params: (params) => {
        const { operation, apiKey, ...rest } = params

        switch (operation) {
          case 'create_note':
            return {
              apiKey,
              title: rest.title,
              content: rest.content,
              notebookGuid: rest.notebookGuid || undefined,
              tagNames: rest.tagNames || undefined,
            }
          case 'get_note':
            return {
              apiKey,
              noteGuid: rest.noteGuid,
              withContent: rest.withContent !== 'false',
            }
          case 'update_note':
            return {
              apiKey,
              noteGuid: rest.noteGuid,
              title: rest.updateTitle || undefined,
              content: rest.updateContent || undefined,
              notebookGuid: rest.notebookGuid || undefined,
              tagNames: rest.tagNames || undefined,
            }
          case 'delete_note':
            return {
              apiKey,
              noteGuid: rest.noteGuid,
            }
          case 'copy_note':
            return {
              apiKey,
              noteGuid: rest.noteGuid,
              toNotebookGuid: rest.toNotebookGuid,
            }
          case 'search_notes':
            return {
              apiKey,
              query: rest.query,
              notebookGuid: rest.notebookGuid || undefined,
              offset: rest.offset ? Number(rest.offset) : 0,
              maxNotes: rest.maxNotes ? Number(rest.maxNotes) : 25,
            }
          case 'get_notebook':
            return {
              apiKey,
              notebookGuid: rest.notebookGuid,
            }
          case 'create_notebook':
            return {
              apiKey,
              name: rest.notebookName,
              stack: rest.stack || undefined,
            }
          case 'list_notebooks':
            return { apiKey }
          case 'create_tag':
            return {
              apiKey,
              name: rest.tagName,
              parentGuid: rest.parentGuid || undefined,
            }
          case 'list_tags':
            return { apiKey }
          default:
            return { apiKey }
        }
      },
    },
  },

  inputs: {
    apiKey: { type: 'string', description: 'Evernote developer token' },
    operation: { type: 'string', description: 'Operation to perform' },
    title: { type: 'string', description: 'Note title' },
    content: { type: 'string', description: 'Note content' },
    noteGuid: { type: 'string', description: 'Note GUID' },
    updateTitle: { type: 'string', description: 'New note title' },
    updateContent: { type: 'string', description: 'New note content' },
    toNotebookGuid: { type: 'string', description: 'Destination notebook GUID' },
    query: { type: 'string', description: 'Search query' },
    notebookGuid: { type: 'string', description: 'Notebook GUID' },
    notebookName: { type: 'string', description: 'Notebook name' },
    stack: { type: 'string', description: 'Notebook stack name' },
    tagName: { type: 'string', description: 'Tag name' },
    parentGuid: { type: 'string', description: 'Parent tag GUID' },
    tagNames: { type: 'string', description: 'Comma-separated tag names' },
    maxNotes: { type: 'string', description: 'Maximum number of results' },
    offset: { type: 'string', description: 'Starting index for results' },
    withContent: { type: 'string', description: 'Whether to include note content' },
  },

  outputs: {
    note: { type: 'json', description: 'Note data' },
    notebook: { type: 'json', description: 'Notebook data' },
    notebooks: { type: 'json', description: 'List of notebooks' },
    tag: { type: 'json', description: 'Tag data' },
    tags: { type: 'json', description: 'List of tags' },
    totalNotes: { type: 'number', description: 'Total number of matching notes' },
    notes: { type: 'json', description: 'List of note metadata' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    noteGuid: { type: 'string', description: 'GUID of the affected note' },
  },
}
