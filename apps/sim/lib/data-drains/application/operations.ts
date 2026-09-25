import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

const policy = {
  minimumRole: 'admin',
  principalKinds: ['session', 'organization_delegated'],
  delegationAudience: 'sim:settings',
  delegatedServices: ['copilot'],
  /** permission-group-exempt: organization administrators govern organization-wide exports. */
  capability: 'none',
} as const

export const dataDrainOperations = Object.freeze({
  // permission-group-exempt: organization administrators govern organization-wide exports.
  list: defineOrganizationOperation({
    id: 'organization.data_drains.list',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  get: defineOrganizationOperation({
    id: 'organization.data_drains.get',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  create: defineOrganizationOperation({
    id: 'organization.data_drains.create',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  update: defineOrganizationOperation({
    id: 'organization.data_drains.update',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  delete: defineOrganizationOperation({
    id: 'organization.data_drains.delete',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  test: defineOrganizationOperation({
    id: 'organization.data_drains.test',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  run: defineOrganizationOperation({
    id: 'organization.data_drains.run',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  runs: defineOrganizationOperation({
    id: 'organization.data_drains.runs',
    ...policy,
    capability: 'none',
  }),
})
export type DataDrainOperation = (typeof dataDrainOperations)[keyof typeof dataDrainOperations]
