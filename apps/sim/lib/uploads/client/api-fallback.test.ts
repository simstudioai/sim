/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadViaApiFallbackWithMetadata } from '@/lib/uploads/client/api-fallback'

const mockFetch = vi.fn()

describe('uploadViaApiFallbackWithMetadata', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds execution multipart fields and normalizes an array response', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'file-1',
              name: 'diagram.png',
              url: '/api/files/serve/execution%2Fdiagram.png',
              size: 7,
              type: 'image/png',
              key: 'execution/diagram.png',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const file = new File(['diagram'], 'diagram.png', { type: 'image/png' })

    const result = await uploadViaApiFallbackWithMetadata(file, 'execution', {
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    expect(result).toEqual({
      id: 'file-1',
      name: 'diagram.png',
      path: '/api/files/serve/execution%2Fdiagram.png',
      size: 7,
      type: 'image/png',
      key: 'execution/diagram.png',
    })

    const request = mockFetch.mock.calls[0]?.[1] as RequestInit
    const formData = request.body as FormData
    expect(formData.get('file')).toBe(file)
    expect(formData.get('context')).toBe('execution')
    expect(formData.get('workspaceId')).toBe('workspace-1')
    expect(formData.get('workflowId')).toBe('workflow-1')
    expect(formData.get('executionId')).toBe('execution-1')
  })

  it('throws the exact server upload error', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Workspace file storage limit exceeded' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(
      uploadViaApiFallbackWithMetadata(
        new File(['report'], 'report.pdf', { type: 'application/pdf' }),
        'execution',
        {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        }
      )
    ).rejects.toThrow('Workspace file storage limit exceeded')
  })
})
