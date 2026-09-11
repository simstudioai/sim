import type { ToolOutputProperty } from '@/tools/types'

export const QUIVER_SVG_V2_OUTPUTS = {
  file: { type: 'file', description: 'First generated SVG stored as a file' },
  files: { type: 'file[]', description: 'All generated SVG files' },
  id: { type: 'string', description: 'Request ID', optional: true },
  usage: {
    type: 'json',
    description: 'Token usage statistics',
    optional: true,
    properties: {
      totalTokens: { type: 'number', description: 'Total tokens used' },
      inputTokens: { type: 'number', description: 'Input tokens used' },
      outputTokens: { type: 'number', description: 'Output tokens used' },
    },
  },
} satisfies Record<string, ToolOutputProperty>
