import { describe, expect, it, vi } from 'vitest'

const { logger } = vi.hoisted(() => ({ logger: { error: vi.fn() } }))
vi.mock('@sim/logger', () => ({ createLogger: () => logger }))

import {
  reportDurableSecretProvenanceRefusal,
  reportDurableSecretProvenanceWrite,
} from '@/lib/execution/durable-secret-provenance-telemetry'

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
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Refusing unavailable durable secret provenance',
      {
        surface: 'workspace-file',
        cause: 'workspace-file-opaque-secret-content',
        workspaceId: 'workspace-1',
        resourceId: 'file-1',
      }
    )
  })
})
