/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PermissionGroupContentionError } from '@/lib/permission-groups/application/management-errors'
import { permissionGroupErrorPolicy } from '@/app/api/organizations/[id]/permission-groups/utils'

describe('permission group HTTP error projection', () => {
  const policy = permissionGroupErrorPolicy('Failed to update permission group')
  it('preserves retryable lock contention as 503', () => {
    expect(policy.project(new PermissionGroupContentionError('group'))).toMatchObject({
      status: 503,
      body: { error: 'This group is being updated by another request. Please try again.' },
    })
  })
  it('preserves admin and enterprise authorization errors', () => {
    for (const message of [
      'Admin permissions required',
      'Access Control is an Enterprise feature',
    ]) {
      expect(policy.project(new OrchestrationError('forbidden', message))).toMatchObject({
        status: 403,
        body: { error: message },
      })
    }
  })
  it('does not classify raw infrastructure errors as safe client errors', () => {
    expect(policy.project(new Error('private database details'))).toBeNull()
  })
})
