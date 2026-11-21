/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableConflictError } from '@/lib/table/service'
import { WorkspaceFileFolderConflictError } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { FileConflictError } from '@/lib/uploads/contexts/workspace/file-manager'
import { WorkflowSourceNameTakenError } from '@/lib/workflows/application/source-error'
import {
  refusalDiagnostic,
  WorkspaceSourceRejectedError,
} from '@/lib/workspace-source/application/errors'

describe('refusalDiagnostic', () => {
  it('reports a name a child use case finds taken as E_NAME_TAKEN', () => {
    expect(refusalDiagnostic(new TableConflictError('leads'), { kind: 'table' }).code).toBe(
      'E_NAME_TAKEN'
    )
  })

  it('scopes a taken workflow name to its folder, where the uniqueness check runs', () => {
    const finding = refusalDiagnostic(new WorkflowSourceNameTakenError('Ingest'), {
      kind: 'workflow',
      key: 'ingest',
    })

    expect(finding.code).toBe('E_NAME_TAKEN')
    expect(finding.message).not.toContain('workspace')
    expect(finding.message).toContain('folder')
  })

  it('hints a taken file name be renamed locally, as a file has no declaration', () => {
    const finding = refusalDiagnostic(new FileConflictError('notes.txt'), {
      kind: 'file',
      key: 'notes.txt',
    })

    expect(finding.code).toBe('E_NAME_TAKEN')
    expect(finding.hint).not.toContain('declaration')
    expect(finding.hint).toContain('locally')
  })

  it('hints a folder in a file path that a folder in Sim holds be renamed, not a file', () => {
    const finding = refusalDiagnostic(new WorkspaceFileFolderConflictError('reports'), {
      kind: 'file',
      key: 'reports/q3.csv',
    })

    expect(finding.code).toBe('E_NAME_TAKEN')
    expect(finding.hint).toContain('folder')
    expect(finding.hint).not.toContain('the file that holds')
  })

  it('rethrows an outage, so the request answers 503 rather than blaming the caller', () => {
    const outage = new OrchestrationError('unavailable', 'The egress gateway is unreachable')
    expect(() => refusalDiagnostic(outage, { kind: 'table', key: 'leads' })).toThrow(outage)
  })

  it('reports a size limit a child use case enforces as E_LIMIT_EXCEEDED, so the apply answers 413', () => {
    const tooLarge = new OrchestrationError('payload_too_large', 'The document is over 100 MB')
    const finding = refusalDiagnostic(tooLarge, { kind: 'knowledge-base', key: 'policies' })

    expect(finding).toMatchObject({
      code: 'E_LIMIT_EXCEEDED',
      message: 'The document is over 100 MB',
    })
    expect(new WorkspaceSourceRejectedError([finding]).code).toBe('payload_too_large')
  })

  it('reports any other conflict as a refusal with its message, not a taken name', () => {
    const busy = new OrchestrationError('conflict', 'A job is already in progress for this table')
    expect(refusalDiagnostic(busy, { kind: 'table', key: 'leads' })).toMatchObject({
      code: 'E_APPLY_REFUSED',
      message: 'A job is already in progress for this table',
    })
  })
})
