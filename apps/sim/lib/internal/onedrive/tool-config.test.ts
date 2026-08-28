/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { uploadTool } from '@/tools/onedrive/upload'

describe('OneDrive upload operation config', () => {
  it('passes resolved text and structured values through without coercion', () => {
    const values = [['<large_value.cell>'], ['{{WORKFLOW_VALUE}}']]
    const input = uploadTool.operation.input({
      accessToken: '{{ONEDRIVE_TOKEN}}',
      fileName: '<previous.fileName>',
      content: '<large_value.content>',
      values,
    }) as { content: unknown; values: unknown }

    expect(input.content).toBe('<large_value.content>')
    expect(input.values).toBe(values)
    expect('request' in uploadTool).toBe(false)
  })
})
