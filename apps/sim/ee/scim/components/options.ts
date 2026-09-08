import type { ScimGroupMappingView } from '@/lib/api/contracts/organization-scim'

/** Option lists and setting descriptions for the directory provisioning settings section. */

export type MappingTargetKind = ScimGroupMappingView['targetKind']
export type WorkspacePermission = NonNullable<ScimGroupMappingView['permissionType']>

export const TARGET_KIND_OPTIONS = [
  { value: 'permission_group', label: 'Permission group' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'org_role', label: 'Organization admin' },
] as const

export const PERMISSION_OPTIONS = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
] as const

export const SETTING_TOGGLES = [
  {
    key: 'lockManualMembership',
    label: 'Lock managed membership',
    description:
      'Prevent manual invitations, role changes, and access grants for provisioned members.',
  },
  {
    key: 'disableJit',
    label: 'Disable just-in-time provisioning',
    description:
      'Prevent SSO from adding new organization members. Existing members can still sign in.',
  },
  {
    key: 'autoMapPermissionGroupsByName',
    label: 'Match permission groups by name',
    description: 'Map directory groups to existing permission groups with the same name.',
  },
] as const

/** Credential lifetimes offered at issue time; `never` matches what Okta and Entra expect by default. */
export const CREDENTIAL_EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires' },
  { value: '90', label: 'Expires in 90 days' },
  { value: '365', label: 'Expires in 1 year' },
] as const

export type CredentialExpiry = (typeof CREDENTIAL_EXPIRY_OPTIONS)[number]['value']
