import { defineOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const policy = { minimumRole: 'member', principalKinds: ['session'] } as const

/** Every member may follow and curate Sim links; per-link edit access is enforced by the use cases. */
export const simLinkOperations = {
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  list: defineOrganizationOperation({
    id: 'organization.sim_links.list',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  create: defineOrganizationOperation({
    id: 'organization.sim_links.create',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  update: defineOrganizationOperation({
    id: 'organization.sim_links.update',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  delete: defineOrganizationOperation({
    id: 'organization.sim_links.delete',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: Sim links are organization-wide shortcuts, not a governed capability.
  resolve: defineOrganizationOperation({
    id: 'organization.sim_links.resolve',
    ...policy,
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
