/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({ downloadGoogleVaultExportFile: vi.fn() }))

vi.mock('@/lib/internal/google-vault/operations', () => ({
  downloadGoogleVaultExportFile: mocks.downloadGoogleVaultExportFile,
}))

import { executeGoogleVaultTool as executeGoogleVaultToolOperation } from '@/lib/internal/google-vault/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

async function executeGoogleVaultTool(
  request: Parameters<typeof executeGoogleVaultToolOperation>[0]
): Promise<Response> {
  const result = await executeGoogleVaultToolOperation(request)
  if (!(result instanceof Response)) throw new Error('Expected a JSON response')
  return result
}

describe('executeGoogleVaultTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadGoogleVaultExportFile.mockResolvedValue({ success: true, output: {} })
  })

  it('forwards file bytes without serializing the file result', async () => {
    const fileResult = createInternalToolFileResult(
      { buffer: Buffer.from('file'), name: 'file.txt', mimeType: 'text/plain' },
      (file) => ({ success: true, output: { file } })
    )
    mocks.downloadGoogleVaultExportFile.mockResolvedValueOnce(fileResult)
    expect(
      await executeGoogleVaultToolOperation({
        toolId: 'google_vault_download_export_file',
        input: {
          accessToken: 'token',
          matterId: 'matter-1',
          bucketName: 'bucket',
          objectName: 'file.zip',
        },
        headers: new Headers(),
        context: createExecutionContext(),
        requestId: 'request-1',
      })
    ).toBe(fileResult)
  })

  it('dispatches typed input and cancellation without HTTP metadata', async () => {
    const controller = new AbortController()
    const request: InternalToolOperationCall = {
      toolId: 'google_vault_download_export_file',
      input: {
        accessToken: 'token',
        matterId: 'matter-1',
        bucketName: 'bucket-1',
        objectName: 'exports/result.zip',
      },
      headers: new Headers(),
      context: createExecutionContext(),
      requestId: 'request-1',
      signal: controller.signal,
    }

    const response = await executeGoogleVaultTool(request)

    expect(response.status).toBe(200)
    expect(mocks.downloadGoogleVaultExportFile).toHaveBeenCalledWith(request.input, {
      signal: controller.signal,
    })
  })
})
