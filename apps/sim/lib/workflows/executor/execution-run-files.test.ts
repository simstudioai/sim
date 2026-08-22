/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mocks.downloadFile,
}))

import {
  describeWorkflowRunFiles,
  workflowRunFileDownloadPath,
} from '@/lib/workflows/executor/execution-run-files'
import type { UserFile } from '@/executor/types'

const WORKFLOW_ID = 'workflow-1'
const RUN_ID = 'run-1'

function runFile(overrides: Partial<UserFile> = {}): UserFile {
  return {
    id: 'file_report',
    name: 'report.pdf',
    url: '/api/files/serve/s3/execution%2Fws%2Fwf%2Frun%2Freport.pdf',
    size: 3,
    type: 'application/pdf',
    key: 'execution/ws/wf/run/report.pdf',
    ...overrides,
  }
}

function filesMap(files: UserFile[]): Map<string, UserFile> {
  return new Map(files.map((file) => [file.id, file]))
}

describe('describeWorkflowRunFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadFile.mockResolvedValue(Buffer.from('pdf'))
  })

  it('describes files without their storage key', async () => {
    const [descriptor] = await describeWorkflowRunFiles(filesMap([runFile()]), {
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      includeBase64: false,
    })

    expect(descriptor).toEqual({
      id: 'file_report',
      name: 'report.pdf',
      size: 3,
      type: 'application/pdf',
      downloadPath: `/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/files/file_report`,
      base64: null,
    })
    expect(descriptor).not.toHaveProperty('key')
  })

  it('does not read storage when base64 was not requested', async () => {
    await describeWorkflowRunFiles(filesMap([runFile()]), {
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      includeBase64: false,
    })

    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it('inlines bytes when requested', async () => {
    const [descriptor] = await describeWorkflowRunFiles(filesMap([runFile()]), {
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      includeBase64: true,
    })

    expect(descriptor.base64).toBe(Buffer.from('pdf').toString('base64'))
    expect(mocks.downloadFile).toHaveBeenCalledWith({
      key: 'execution/ws/wf/run/report.pdf',
      context: 'execution',
      maxBytes: 16 * 1024 * 1024,
    })
  })

  /**
   * The 413 must name the download path, so a caller that hits the ceiling is
   * told exactly how to get the bytes instead of being left stuck.
   */
  it('rejects a file above the inline ceiling and names its download path', async () => {
    await expect(
      describeWorkflowRunFiles(filesMap([runFile({ size: 17 * 1024 * 1024 })]), {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        includeBase64: true,
      })
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining(
        `/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/files/file_report`
      ),
    })
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it('clamps a caller ceiling above the server limit', async () => {
    await expect(
      describeWorkflowRunFiles(filesMap([runFile({ size: 17 * 1024 * 1024 })]), {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        includeBase64: true,
        base64MaxBytes: 500 * 1024 * 1024,
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('honours a caller ceiling below the server limit', async () => {
    await expect(
      describeWorkflowRunFiles(filesMap([runFile({ size: 2048 })]), {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        includeBase64: true,
        base64MaxBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  /**
   * The per-file ceiling bounds one file; without an aggregate ceiling a run with
   * many files multiplied it by the file count and the response was unbounded.
   */
  it('rejects an inline set whose total exceeds the response ceiling', async () => {
    const files = filesMap([
      runFile({ id: 'file_a', name: 'a.pdf', size: 9 * 1024 * 1024 }),
      runFile({ id: 'file_b', name: 'b.pdf', size: 9 * 1024 * 1024 }),
    ])

    await expect(
      describeWorkflowRunFiles(files, {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        includeBase64: true,
      })
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      message: expect.stringContaining(
        `/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/files/file_b`
      ),
    })
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  /** A recorded size that understates the object must not slip past the ceiling. */
  it('rejects when the bytes actually read exceed the response ceiling', async () => {
    mocks.downloadFile.mockResolvedValue(Buffer.alloc(9 * 1024 * 1024))
    const files = filesMap([
      runFile({ id: 'file_a', name: 'a.pdf', size: 1 }),
      runFile({ id: 'file_b', name: 'b.pdf', size: 1 }),
    ])

    await expect(
      describeWorkflowRunFiles(files, {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        includeBase64: true,
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  /**
   * Retention sweeps a run's objects while its log row remains, so asking a
   * settled run for its inline files can reach an object that is gone. That is
   * an absent object, not a server fault — propagating the provider error would
   * render a 500 for a well-formed request.
   */
  it.each(['NoSuchKey', 'BlobNotFound', 'NotFound'])(
    'reports a swept object (%s) as not found rather than a fault',
    async (name) => {
      mocks.downloadFile.mockRejectedValueOnce(Object.assign(new Error('gone'), { name }))

      await expect(
        describeWorkflowRunFiles(filesMap([runFile({ name: 'report.pdf' })]), {
          workflowId: WORKFLOW_ID,
          runId: RUN_ID,
          includeBase64: true,
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  /** A missing bucket is a misconfiguration worth alerting on, not an absent file. */
  it('propagates a storage outage rather than reporting it as not found', async () => {
    mocks.downloadFile.mockRejectedValueOnce(new Error('s3 unavailable'))

    await expect(
      describeWorkflowRunFiles(filesMap([runFile()]), {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        includeBase64: true,
      })
    ).rejects.toThrow('s3 unavailable')
  })

  it('bounds how many inline reads are in flight at once', async () => {
    let inFlight = 0
    let peak = 0
    mocks.downloadFile.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return Buffer.from('pdf')
    })
    const files = filesMap(
      Array.from({ length: 20 }, (_, index) =>
        runFile({ id: `file_${index}`, name: `${index}.pdf`, size: 3 })
      )
    )

    await describeWorkflowRunFiles(files, {
      workflowId: WORKFLOW_ID,
      runId: RUN_ID,
      includeBase64: true,
    })

    expect(mocks.downloadFile).toHaveBeenCalledTimes(20)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('builds the download path from the run identifiers', () => {
    expect(workflowRunFileDownloadPath('wf-9', 'run-9', 'file-9')).toBe(
      '/api/v2/workflows/wf-9/runs/run-9/files/file-9'
    )
  })
})
