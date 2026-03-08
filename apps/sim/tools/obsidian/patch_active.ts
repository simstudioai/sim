import type { ToolConfig } from '@/tools/types'
import type { ObsidianPatchActiveParams, ObsidianPatchActiveResponse } from './types'

export const patchActiveTool: ToolConfig<ObsidianPatchActiveParams, ObsidianPatchActiveResponse> = {
  id: 'obsidian_patch_active',
  name: 'Obsidian Patch Active File',
  description:
    'Insert or replace content at a specific heading, block reference, or frontmatter field in the active file',
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
      return `${base}/active/`
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

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to patch active file: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        patched: true,
      },
    }
  },

  outputs: {
    patched: {
      type: 'boolean',
      description: 'Whether the active file was successfully patched',
    },
  },
}
