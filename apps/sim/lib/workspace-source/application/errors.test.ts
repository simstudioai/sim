/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableConflictError } from '@/lib/table/service'
import { refusalDiagnostic } from '@/lib/workspace-source/application/errors'

describe('refusalDiagnostic', () => {
  it('reports a name a child use case finds taken as E_NAME_TAKEN', () => {
    expect(refusalDiagnostic(new TableConflictError('leads'), { kind: 'table' }).code).toBe(
      'E_NAME_TAKEN'
    )
  })

  it('reports any other conflict as a refusal with its message, not a taken name', () => {
    const busy = new OrchestrationError('conflict', 'A job is already in progress for this table')
    expect(refusalDiagnostic(busy, { kind: 'table', key: 'leads' })).toMatchObject({
      code: 'E_APPLY_REFUSED',
      message: 'A job is already in progress for this table',
    })
  })
})
