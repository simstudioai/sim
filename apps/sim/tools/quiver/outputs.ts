import type { ToolOutputProperty } from '@/tools/types'

export const QUIVER_SVG_V2_OUTPUTS = {
  files: { type: 'file[]', description: 'All generated SVG files' },
  id: { type: 'string', description: 'Request ID', nullable: true },
  usage: {
    type: 'json',
    description: 'Token usage statistics',
    nullable: true,
    properties: {
      totalTokens: { type: 'number', description: 'Total tokens used' },
      inputTokens: { type: 'number', description: 'Input tokens used' },
      outputTokens: { type: 'number', description: 'Output tokens used' },
    },
  },
} satisfies Record<string, ToolOutputProperty>
