import { describe, expect, it } from 'vitest'
import {
  UsageWindowRangeInvertedError,
  UsageWindowRangeTooLargeError,
} from '@/lib/billing/core/usage-analytics'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

describe('internal organization usage error compatibility', () => {
  it.each([
    new OrganizationMembershipNotFoundError(),
    new ForbiddenOperationError(
      'ORGANIZATION_ADMIN_REQUIRED',
      'Organization administrator access is required'
    ),
  ])('preserves non-admin 403 responses after shared authorization migration', (error) => {
    expect(organizationUsageErrorPolicy.project(error)).toEqual({
      status: 403,
      body: { error: 'Organization admin or owner authority is required to read pooled usage' },
    })
  })

  it.each([new UsageWindowRangeInvertedError(), new UsageWindowRangeTooLargeError(100)])(
    'preserves invalid custom range responses',
    (error) => {
      expect(organizationUsageErrorPolicy.project(error)).toEqual({
        status: 400,
        body: { error: error.message },
      })
    }
  )
})
