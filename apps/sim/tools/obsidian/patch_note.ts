import type { ToolConfig } from '@/tools/types'
import type { ObsidianPatchNoteParams, ObsidianPatchNoteResponse } from './types'

export const patchNoteTool: ToolConfig<ObsidianPatchNoteParams, ObsidianPatchNoteResponse> = {
  id: 'obsidian_patch_note',
  name: 'Obsidian Patch Note',
  description:
    'Insert or replace content at a specific heading, block reference, or frontmatter field in a note',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key from Obsidian Local REST API plugin settings',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL for the Obsidian Local REST API',
    },
    filename: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path to the note relative to vault root (e.g. "folder/note.md")',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content to insert at the target location',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'How to insert content: append, prepend, or replace',
    },
    targetType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of target: heading, block, or frontmatter',
    },
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Target identifier (heading text, block reference ID, or frontmatter field name)',
    },
    targetDelimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delimiter for nested headings (default: "::")',
    },
    trimTargetWhitespace: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to trim whitespace from target before matching (default: false)',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/vault/${params.filename.trim().split('/').map(encodeURIComponent).join('/')}`
    },
    method: 'PATCH',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'text/markdown',
        Operation: params.operation,
        'Target-Type': params.targetType,
        Target: encodeURIComponent(params.target),
      }
      if (params.targetDelimiter) {
        headers['Target-Delimiter'] = params.targetDelimiter
      }
      if (params.trimTargetWhitespace) {
        headers['Trim-Target-Whitespace'] = 'true'
      }
      return headers
    },
    body: (params) => params.content,
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to patch note: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        filename: params?.filename ?? '',
        patched: true,
      },
    }
  },

  outputs: {
    filename: {
      type: 'string',
      description: 'Path of the patched note',
    },
    patched: {
      type: 'boolean',
      description: 'Whether the note was successfully patched',
    },
  },
}
