/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ downloadGoogleVaultExportFile: vi.fn() }))

vi.mock('@/lib/internal/google-vault/operations', () => ({
  downloadGoogleVaultExportFile: mocks.downloadGoogleVaultExportFile,
}))

import { executeGoogleVaultTool } from '@/lib/internal/google-vault/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

describe('executeGoogleVaultTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadGoogleVaultExportFile.mockResolvedValue({ success: true, output: {} })
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
