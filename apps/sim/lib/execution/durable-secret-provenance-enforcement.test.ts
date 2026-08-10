/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockLogger } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@sim/logger', () => ({ createLogger: () => mockLogger }))

import {
  DURABLE_SECRET_PROVENANCE_SURFACES,
  isDurableSecretProvenanceEnforced,
  reportUnrecordedDurableProvenance,
  resetDurableSecretProvenanceEnforcementCache,
} from '@/lib/execution/durable-secret-provenance-enforcement'

function configure(value: string | undefined): void {
  mockEnv.DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES = value
  resetDurableSecretProvenanceEnforcementCache()
}

describe('durable secret provenance enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configure(undefined)
  })

  it('enforces nothing by default, so unrecorded provenance warns instead of latching', () => {
    for (const surface of DURABLE_SECRET_PROVENANCE_SURFACES) {
      expect(isDurableSecretProvenanceEnforced(surface)).toBe(false)
    }
  })

  it('closes one surface at a time without touching the others', () => {
    configure('table-row')

    expect(isDurableSecretProvenanceEnforced('table-row')).toBe(true)
    expect(isDurableSecretProvenanceEnforced('memory')).toBe(false)
    expect(isDurableSecretProvenanceEnforced('knowledge')).toBe(false)
  })

  it('accepts a comma-separated subset, ignoring case and padding', () => {
    configure(' Memory , TABLE-ROW ')

    expect(isDurableSecretProvenanceEnforced('memory')).toBe(true)
    expect(isDurableSecretProvenanceEnforced('table-row')).toBe(true)
    expect(isDurableSecretProvenanceEnforced('knowledge')).toBe(false)
  })

  it('closes every surface on "all"', () => {
    configure('all')

    for (const surface of DURABLE_SECRET_PROVENANCE_SURFACES) {
      expect(isDurableSecretProvenanceEnforced(surface)).toBe(true)
    }
  })

  it('reports an unrecognized surface rather than silently enforcing nothing', () => {
    configure('memory,workspace-file')

    expect(isDurableSecretProvenanceEnforced('memory')).toBe(true)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Ignoring unrecognized durable secret provenance surfaces',
      expect.objectContaining({ unrecognized: ['workspace-file'] })
    )
  })

  it('reports at error with the surface, cause, and affected count so it survives every LOG_LEVEL default', () => {
    reportUnrecordedDurableProvenance({
      surface: 'table-row',
      cause: 'row-sidecar-not-exact',
      affectedCount: 8,
      workspaceId: 'workspace-1',
    })

    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Proceeding on unrecorded durable secret provenance',
      {
        surface: 'table-row',
        cause: 'row-sidecar-not-exact',
        enforced: false,
        affectedCount: 8,
        workspaceId: 'workspace-1',
      }
    )
  })
})
