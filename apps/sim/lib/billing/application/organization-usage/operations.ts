import type { Principal } from '@sim/auth/principal'
import {
  defineOrganizationOperation,
  type OrganizationOperation,
} from '@/lib/core/application/organization-operation'

export type OrganizationUsagePrincipal = Extract<
  Principal,
  { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }
>

export interface OrganizationUsageOperation extends OrganizationOperation {
  readonly authority: 'organization_billing_admin'
  readonly organizationRoles: readonly ['admin', 'owner']
  readonly workspaceApiKey: 'deny'
  readonly principalKinds: readonly OrganizationUsagePrincipal['kind'][]
}

const BASE = {
  authority: 'organization_billing_admin',
  organizationRoles: ['admin', 'owner'],
  minimumRole: 'admin',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
} as const

const PUBLIC_READ = {
  ...BASE,
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  oauthScope: 'api:read',
} as const

/**
 * Every one takes `capability: 'none'`, written out at each call site rather than
 * folded into `BASE`: `check:permission-group-enforcement` reads the literal at
 * the call site, and a capability arriving through a spread is a capability
 * nothing outside the type system ever sees.
 */
export const organizationUsageOperations = {
  /**
   * permission-group-exempt: aggregate organization activity is governed by organization admin authority, not a workspace permission group
   */
  readActivitySummary: defineOrganizationOperation({
    id: 'organization_usage.activity.summary.read',
    capability: 'none',
    ...BASE,
  }),
  /**
   * permission-group-exempt: organization activity breakdowns require the same organization admin authority as the summary
   */
  readActivityBreakdown: defineOrganizationOperation({
    id: 'organization_usage.activity.breakdown.read',
    capability: 'none',
    ...BASE,
  }),
  /**
   * permission-group-exempt: the Insights overview reads the same pooled ledger as the summary, governed by organization billing-admin authority
   */
  readOverview: defineOrganizationOperation({
    id: 'organization_usage.overview.read',
    capability: 'none',
    ...BASE,
  }),
  /**
   * permission-group-exempt: the organization's pooled ledger is authorized by organization billing-admin authority, which no workspace-shaped group key names
   */
  readSummary: defineOrganizationOperation({
    id: 'organization_usage.summary.read',
    capability: 'none',
    ...PUBLIC_READ,
  }),
  /**
   * permission-group-exempt: the same pooled ledger, broken down; organization billing-admin authority governs it
   */
  readBreakdown: defineOrganizationOperation({
    id: 'organization_usage.breakdown.read',
    capability: 'none',
    ...PUBLIC_READ,
  }),
  /**
   * permission-group-exempt: organization billing events, governed by organization billing-admin authority rather than a workspace group
   */
  listEvents: defineOrganizationOperation({
    id: 'organization_usage.events.list',
    capability: 'none',
    ...PUBLIC_READ,
  }),
  /**
   * permission-group-exempt: exports the same organization billing events; logs.export names workflow run logs, not the billing ledger
   */
  exportEvents: defineOrganizationOperation({
    id: 'organization_usage.events.export',
    capability: 'none',
    ...BASE,
  }),
} as const
