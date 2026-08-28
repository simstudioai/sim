/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { daytonaUploadFileTool } from '@/tools/daytona/upload_file'

describe('Daytona upload operation declaration', () => {
  it('contains operation input and no internal URL metadata', () => {
    expect(daytonaUploadFileTool.operation).toBeDefined()
    expect('request' in daytonaUploadFileTool).toBe(false)
  })
})
