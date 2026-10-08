import { defineOperation } from '@/lib/core/application/operation'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

/**
 * Admits a newly authenticated SSO identity before organization membership
 * exists. Workspace-role authorization cannot apply yet; the use case instead
 * proves the exact provider link, verified domain, and provider-bound target.
 */
// permission-group-exempt: SSO admission runs before any organization membership exists, so no group can govern the identity being admitted yet
export const ssoJitAdmissionOperation = defineOperation({
  id: 'sso.jit-admit',
  principalKinds: ['session'] as const,
  capability: 'none',
})

const principals = ['session', 'personal_api_key', 'oauth_access_token'] as const

export const ssoProviderOperations = {
  // permission-group-exempt: organization SSO settings require current owner or administrator membership.
  list: defineOrganizationOperation({
    id: 'organization.sso.providers.list',
    minimumRole: 'admin',
    principalKinds: principals,
    oauthScope: 'api:read',
    capability: 'none',
  }),
  // permission-group-exempt: organization SSO settings require current owner or administrator membership and enterprise entitlement.
  save: defineOrganizationOperation({
    id: 'organization.sso.providers.save',
    minimumRole: 'admin',
    principalKinds: principals,
    oauthScope: 'api:write',
    capability: 'none',
  }),
  // permission-group-exempt: organization SSO settings require current owner or administrator membership.
  delete: defineOrganizationOperation({
    id: 'organization.sso.providers.delete',
    minimumRole: 'admin',
    principalKinds: principals,
    oauthScope: 'api:write',
    capability: 'none',
  }),
} as const

export const ssoSettingsOperations = {
  // permission-group-exempt: organization SSO settings use current membership, administrator role and entitlement.
  readRequirement: defineOrganizationOperation({
    id: 'organization.sso.read_requirement',
    oauthScope: 'api:read',
    minimumRole: 'member',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'none',
  }),
  // permission-group-exempt: organization SSO settings use current membership, administrator role and entitlement.
  setRequirement: defineOrganizationOperation({
    id: 'organization.sso.set_requirement',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'none',
  }),
  // permission-group-exempt: organization SSO settings use current membership, administrator role and entitlement.
  setPrimary: defineOrganizationOperation({
    id: 'organization.sso.set_primary_provider',
    oauthScope: 'api:write',
    minimumRole: 'admin',
    principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
    capability: 'none',
  }),
} as const
