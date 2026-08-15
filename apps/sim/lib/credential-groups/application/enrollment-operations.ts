import type { ApplicationOperation } from '@/lib/core/application'

export interface CredentialGroupEnrollmentOperation<Id extends string = string>
  extends ApplicationOperation<Id> {
  readonly principalKind: 'credential_group_enrollment'
}

function defineCredentialGroupEnrollmentOperation<const Id extends string>(
  operation: CredentialGroupEnrollmentOperation<Id>
): CredentialGroupEnrollmentOperation<Id> {
  if (!operation.id.trim()) throw new Error('Credential Group enrollment operation ID is required')
  return Object.freeze(operation)
}

export const credentialGroupEnrollmentOperations = {
  read: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.read',
    principalKind: 'credential_group_enrollment',
  }),
  startOAuth: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.oauth.start',
    principalKind: 'credential_group_enrollment',
  }),
  completeOAuth: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.oauth.complete',
    principalKind: 'credential_group_enrollment',
  }),
  complete: defineCredentialGroupEnrollmentOperation({
    id: 'credential_groups.enrollment.complete',
    principalKind: 'credential_group_enrollment',
  }),
} as const
