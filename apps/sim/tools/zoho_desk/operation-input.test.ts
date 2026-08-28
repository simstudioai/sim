/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { zohoDeskGetAttachmentTool } from '@/tools/zoho_desk/get_attachment'

describe('Zoho Desk attachment operation declaration', () => {
  it('contains operation input without an internal HTTP request', () => {
    expect(zohoDeskGetAttachmentTool.operation).toBeDefined()
    expect('request' in zohoDeskGetAttachmentTool).toBe(false)
  })
})
