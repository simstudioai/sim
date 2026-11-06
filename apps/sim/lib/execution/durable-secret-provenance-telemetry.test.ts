import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { describe, expect, it } from 'vitest'
import {
  reportDurableSecretProvenanceRefusal,
  reportDurableSecretProvenanceRefusals,
  reportDurableSecretProvenanceWrite,
} from '@/lib/execution/durable-secret-provenance-telemetry'

const logger = getMockLogger('DurableSecretProvenancePersistence')

describe('durable secret provenance telemetry', () => {
  it('reports non-exact writes without including private content or entries', () => {
    const report = {
      surface: 'knowledge' as const,
      status: 'unknown' as const,
      cause: 'source-provenance-unknown' as const,
      recordCount: 2,
      workspaceId: 'workspace-1',
      resourceId: 'document-1',
      content: 'private content',
      entries: [{ encryptedValue: 'private ciphertext' }],
    }
    reportDurableSecretProvenanceWrite(report)
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Writing non-exact durable secret provenance',
      {
        surface: 'knowledge',
        status: 'unknown',
        cause: 'source-provenance-unknown',
        recordCount: 2,
        workspaceId: 'workspace-1',
        resourceId: 'document-1',
      }
    )
  })
  it('reports a refusal without including private content or entries', () => {
    const report = {
      surface: 'workspace-file' as const,
      cause: 'workspace-file-opaque-secret-content' as const,
      workspaceId: 'workspace-1',
      resourceId: 'file-1',
      content: 'private content',
      entries: [{ encryptedValue: 'private ciphertext' }],
    }
    reportDurableSecretProvenanceRefusal(report)
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Refusing unavailable durable secret provenance',
      {
        surface: 'workspace-file',
        cause: 'workspace-file-opaque-secret-content',
        refusedCount: 1,
        workspaceId: 'workspace-1',
        resourceId: 'file-1',
      }
    )
  })
  it('reports a batch once per surface and cause, keeping every id paired with its cause', () => {
    logger.warn.mockClear()
    const reports = Array.from({ length: 163 }, (_, index) => ({
      surface: 'knowledge' as const,
      cause:
        index < 160
          ? ('knowledge-chunk-source-unavailable' as const)
          : ('knowledge-opaque-secret-content' as const),
      workspaceId: 'workspace-1',
      resourceId: `chunk-${index}`,
    }))
    reportDurableSecretProvenanceRefusals(reports)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      'Refusing unavailable durable secret provenance',
      {
        surface: 'knowledge',
        cause: 'knowledge-chunk-source-unavailable',
        refusedCount: 160,
        workspaceId: 'workspace-1',
        resourceIds: reports.slice(0, 160).map((report) => report.resourceId),
      }
    )
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      'Refusing unavailable durable secret provenance',
      {
        surface: 'knowledge',
        cause: 'knowledge-opaque-secret-content',
        refusedCount: 3,
        workspaceId: 'workspace-1',
        resourceIds: ['chunk-160', 'chunk-161', 'chunk-162'],
      }
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('caps the ids of one very large group and says so', () => {
    logger.warn.mockClear()
    reportDurableSecretProvenanceRefusals(
      Array.from({ length: 250 }, (_, index) => ({
        surface: 'table-row' as const,
        cause: 'table-row-provenance-unavailable' as const,
        resourceId: `row-${index}`,
      }))
    )
    const [[, fields]] = logger.warn.mock.calls
    expect(fields).toMatchObject({ refusedCount: 250, resourceIdsTruncated: true })
    expect(fields.resourceIds).toHaveLength(200)
  })
})
