import { describe, expect, it } from 'vitest'
import { FileV4Block } from '@/blocks/blocks/file'

describe('FileV4Block', () => {
  const buildParams = FileV4Block.tools.config.params

  it('accepts http and https URLs for fetch', () => {
    expect(
      buildParams({
        operation: 'file_fetch',
        fileUrl: 'https://example.com/image.jpg',
        _context: {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
      })
    ).toMatchObject({
      filePath: 'https://example.com/image.jpg',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('rejects inline content for fetch', () => {
    expect(() =>
      buildParams({
        operation: 'file_fetch',
        fileUrl: '\u0001\u0002raw jpeg bytes',
      })
    ).toThrow('File URL must be a valid http or https URL')
  })

  it('rejects data URLs for fetch', () => {
    expect(() =>
      buildParams({
        operation: 'file_fetch',
        fileUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
      })
    ).toThrow('File URL must use http or https')
  })

  it('rejects valid URLs with unsupported protocols for fetch', () => {
    expect(() =>
      buildParams({
        operation: 'file_fetch',
        fileUrl: 'ftp://example.com/file.pdf',
      })
    ).toThrow('File URL must use http or https')
  })
})
