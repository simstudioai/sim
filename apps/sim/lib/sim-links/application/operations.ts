import { defineOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const policy = { minimumRole: 'member', principalKinds: ['session'] } as const

/** Chat curates links under the member's delegation through the generic settings tool. */
const settingsPolicy = {
  minimumRole: 'member',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
  contentDelivery: 'none',
} as const

/** Every member may follow and curate Sim links; per-link edit access is enforced by the use cases. */
export const simLinkOperations = {
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  list: defineOrganizationOperation({
    id: 'organization.sim_links.list',
    ...settingsPolicy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  get: defineOrganizationOperation({
    id: 'organization.sim_links.get',
    ...settingsPolicy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  create: defineOrganizationOperation({
    id: 'organization.sim_links.create',
    ...settingsPolicy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  update: defineOrganizationOperation({
    id: 'organization.sim_links.update',
    ...settingsPolicy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  delete: defineOrganizationOperation({
    id: 'organization.sim_links.delete',
    ...settingsPolicy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  resolve: defineOrganizationOperation({
    id: 'organization.sim_links.resolve',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: Managed bookmarks are a Chrome admin export of organization-wide shortcuts.
  exportBookmarks: defineOrganizationOperation({
    id: 'organization.sim_links.export_bookmarks',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'none',
  }),
  /** Not organization-scoped: it serves whichever organization `sim/` opens in for the session. */
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  suggest: defineOperation({
    id: 'sim_links.suggest',
    principalKinds: ['session'],
    capability: 'none',
  }),
} as const
