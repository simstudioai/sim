/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

const { download, upload } = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({ downloadFileFromUrl: download }))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: upload,
  uploadFileFromRawData: vi.fn(),
}))

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'
import { ociDocumentGetJobOutputTool } from '@/tools/oci_document_understanding/get_job_output'

describe('persisted document artifacts', () => {
  it.each([0, 100 * 1024 * 1024])(
    'does not download or re-upload a persisted %i-byte artifact',
    async (size) => {
      const file = {
        id: 'file-1',
        key: 'workspace/workspace-1/file-1',
        name: 'document-output.pdf',
        url: '/api/files/serve?key=workspace%2Fworkspace-1%2Ffile-1',
        size,
        type: 'application/pdf',
      }
      const result = await FileToolProcessor.processToolOutputs(
        { file, jobId: 'job-1' },
        ociDocumentGetJobOutputTool,
        createExecutionContext({
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        })
      )
      expect(result.file).toEqual(file)
      expect(download).not.toHaveBeenCalled()
      expect(upload).not.toHaveBeenCalled()
    }
  )
})
