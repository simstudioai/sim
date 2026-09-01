/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { uploadMediaTool } from '@/tools/wordpress/upload_media'

describe('WordPress upload operation declaration', () => {
  it('has operation input without an internal HTTP request', () => {
    expect(uploadMediaTool.operation).toBeDefined()
    expect('request' in uploadMediaTool).toBe(false)
  })
})
