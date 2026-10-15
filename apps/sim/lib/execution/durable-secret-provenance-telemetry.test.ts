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
        workspaceId: 'workspace-1',
        resourceId: 'file-1',
      }
    )
  })
  it('reports a batch of refusals as one line with counts and a bounded sample', () => {
    logger.warn.mockClear()
    const reports = Array.from({ length: 8 }, (_, index) => ({
      surface: 'table-row' as const,
      cause:
        index < 6
          ? ('table-row-provenance-unavailable' as const)
          : ('table-row-opaque-secret-content' as const),
      workspaceId: 'workspace-1',
      resourceId: `row-${index}`,
    }))
    reportDurableSecretProvenanceRefusals(reports)
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Refusing unavailable durable secret provenance',
      {
        refusedCount: 8,
        causes: {
          'table-row:table-row-provenance-unavailable': 6,
          'table-row:table-row-opaque-secret-content': 2,
        },
        workspaceId: 'workspace-1',
        sampleResourceIds: ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'],
      }
    )
    expect(logger.error).not.toHaveBeenCalled()
  })
})
