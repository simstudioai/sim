/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockLogger, mockRecordAudit } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockRecordAudit: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@sim/logger', () => ({ createLogger: () => mockLogger }))
/** Literal values rather than the real constants: these reach the database and the trail. */
vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { SECRET_PROVENANCE_UNRECORDED: 'secret_provenance.unrecorded' },
  AuditResourceType: { SECRET_PROVENANCE: 'secret_provenance' },
}))

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
    configure('memory,not-a-surface')

    expect(isDurableSecretProvenanceEnforced('memory')).toBe(true)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Ignoring unrecognized durable secret provenance surfaces',
      expect.objectContaining({ unrecognized: ['not-a-surface'] })
    )
  })

  /**
   * `workspace-file` was this test's example of an unrecognized name while the env documentation
   * already offered it — so anyone who set it got a silent no-op and the fail-closed posture they
   * were trying to change. It is a real surface now.
   */
  it('recognizes every surface its own configuration documents', () => {
    configure('workspace-file')

    expect(isDurableSecretProvenanceEnforced('workspace-file')).toBe(true)
    expect(isDurableSecretProvenanceEnforced('table-row')).toBe(false)
    expect(mockLogger.error).not.toHaveBeenCalled()
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
  it('records a workspace-visible audit entry so a fail-open read is not only in our logs', () => {
    reportUnrecordedDurableProvenance({
      surface: 'table-row',
      cause: 'row-sidecar-not-exact',
      affectedCount: 8,
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        action: 'secret_provenance.unrecorded',
        resourceType: 'secret_provenance',
        resourceId: 'table-row',
        metadata: { surface: 'table-row', cause: 'row-sidecar-not-exact', affectedCount: 8 },
      })
    )
  })

  it('still records the entry when the surface cannot name an actor', () => {
    reportUnrecordedDurableProvenance({
      surface: 'memory',
      cause: 'durable-provenance-unknown',
      workspaceId: 'workspace-1',
    })

    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }))
  })

  /** An entry with no workspace names nobody it concerns; the log line still carries it. */
  it('skips the audit entry when there is no workspace to show it to', () => {
    reportUnrecordedDurableProvenance({ surface: 'knowledge', cause: 'durable-provenance-unknown' })

    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
