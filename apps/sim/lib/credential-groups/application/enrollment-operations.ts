import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

export interface CredentialGroupEnrollmentOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly principalKind: 'credential_group_enrollment'
}

function defineCredentialGroupEnrollmentOperation<const Id extends string>(
  operation: CredentialGroupEnrollmentOperation<Id>
): CredentialGroupEnrollmentOperation<Id> {
  if (!operation.id.trim()) throw new Error('Credential Group enrollment operation ID is required')
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

export const credentialGroupEnrollmentOperations = {
  // permission-group-exempt: the enrollment principal is a one-time credential-connect token, not a workspace member, so no permission group governs it
  read: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.read',
    capability: 'none',
    principalKind: 'credential_group_enrollment',
  }),
  // permission-group-exempt: the enrollment principal is a one-time credential-connect token, not a workspace member, so no permission group governs it
  startOAuth: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.oauth.start',
    capability: 'none',
    principalKind: 'credential_group_enrollment',
  }),
  // permission-group-exempt: the enrollment principal is a one-time credential-connect token, not a workspace member, so no permission group governs it
  completeOAuth: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.oauth.complete',
    capability: 'none',
    principalKind: 'credential_group_enrollment',
  }),
  // permission-group-exempt: the enrollment principal is a one-time credential-connect token, not a workspace member, so no permission group governs it
  complete: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.complete',
    capability: 'none',
    principalKind: 'credential_group_enrollment',
  }),
} as const
