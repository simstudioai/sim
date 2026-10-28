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
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  get: defineOrganizationOperation({
    id: 'organization.data_drains.get',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  create: defineOrganizationOperation({
    id: 'organization.data_drains.create',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  update: defineOrganizationOperation({
    id: 'organization.data_drains.update',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  delete: defineOrganizationOperation({
    id: 'organization.data_drains.delete',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  test: defineOrganizationOperation({
    id: 'organization.data_drains.test',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  run: defineOrganizationOperation({
    id: 'organization.data_drains.run',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
  // permission-group-exempt: organization administrators govern organization-wide exports.
  runs: defineOrganizationOperation({
    id: 'organization.data_drains.runs',
    contentDelivery: 'none',
    ...policy,
    capability: 'none',
  }),
})
export type DataDrainOperation = (typeof dataDrainOperations)[keyof typeof dataDrainOperations]
