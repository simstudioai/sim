/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generateToolInputSchema } from '@/lib/mcp/workflow-tool-schema'
import { generateWorkflowInputShape } from '@/lib/workflows/input-schema'

const uploaded = {
  id: 'file-1',
  name: 'report.pdf',
  url: '/api/files/serve/workspace%2Fws%2Freport.pdf',
  size: 24,
  type: 'application/pdf',
  key: 'workspace/ws/report.pdf',
}

describe('workflow file input schema', () => {
  it.each(['file[]', 'files'])(
    'accepts %s uploaded file arrays with ordinary Start input types',
    (type) => {
      const shape = generateWorkflowInputShape([
        { name: 'attachments', type },
        { name: 'name', type: 'string' },
        { name: 'count', type: 'number' },
        { name: 'enabled', type: 'boolean' },
        { name: 'config', type: 'object' },
        { name: 'items', type: 'array' },
      ])
      expect(
        z.object(shape ?? {}).safeParse({
          attachments: [uploaded],
          name: 'run',
          count: 2,
          enabled: false,
          config: { nested: true },
          items: [1, 'two'],
        }).success
      ).toBe(true)
      expect(
        generateToolInputSchema([{ name: 'attachments', type }]).properties.attachments.type
      ).toBe('array')
    }
  )
})
