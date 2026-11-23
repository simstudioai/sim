import { defineOperation } from '@/lib/core/application/operation'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

/**
 * Only a signed-in person in the browser that holds the claim cookie takes part: AWS hands the
 * buyer a claim, never an API client or a delegated assistant.
 */
export const awsMarketplaceOperations = {
  // permission-group-exempt: reads the caller's own pending Marketplace claim and the organizations they administer.
  readClaim: defineOperation({
    id: 'aws_marketplace.claim.read',
    principalKinds: ['session'],
    capability: 'none',
  }),
  // permission-group-exempt: a buyer with no organization takes their own purchase; nothing a group governs is touched.
  registerToAccount: defineOperation({
    id: 'aws_marketplace.license.register_account',
    principalKinds: ['session'],
    capability: 'none',
  }),
  // permission-group-exempt: a buyer waiting on AWS leaves contact details for their own purchase.
  saveClaimContact: defineOperation({
    id: 'aws_marketplace.claim.save_contact',
    principalKinds: ['session'],
    capability: 'none',
  }),
  // permission-group-exempt: a buyer sees the status of a subscription registered to their own account.
  listAccountLicenses: defineOperation({
    id: 'aws_marketplace.license.list_account',
    principalKinds: ['session'],
    capability: 'none',
  }),
  // permission-group-exempt: members see their organization's subscription status, as the billing page shows its plan.
  listOrganizationLicenses: defineOrganizationOperation({
    id: 'organization.aws_marketplace_license.list',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'none',
  }),
  // permission-group-exempt: linking a purchased license is organization administration, not a governed capability.
  linkLicense: defineOrganizationOperation({
    id: 'organization.aws_marketplace_license.link',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const
