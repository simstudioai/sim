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
      'Refuse invitations, role changes, and manual grants for members the directory provisions. The next sync would revert them anyway.',
  },
  {
    key: 'disableJit',
    label: 'Disable just-in-time provisioning',
    description:
      'Refuse membership for someone signing in with SSO who the directory never provisioned. The directory becomes the only way in.',
  },
  {
    key: 'autoMapPermissionGroupsByName',
    label: 'Match permission groups by name',
    description:
      'When a pushed group has the same name as one of your permission groups, map them automatically. Nothing is created.',
  },
] as const

/** Credential lifetimes offered at issue time; `never` matches what Okta and Entra expect by default. */
export const CREDENTIAL_EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires' },
  { value: '90', label: 'Expires in 90 days' },
  { value: '365', label: 'Expires in 1 year' },
] as const

export type CredentialExpiry = (typeof CREDENTIAL_EXPIRY_OPTIONS)[number]['value']
