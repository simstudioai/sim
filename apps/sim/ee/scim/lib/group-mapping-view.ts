import type {
  ScimGroupMappingBody,
  ScimGroupMappingView,
} from '@/lib/api/contracts/organization-scim'
import type { PermissionGroup } from '@/lib/api/contracts/permission-groups'
import {
  type MappingTargetKind,
  PERMISSION_OPTIONS,
  type WorkspacePermission,
} from '@/ee/scim/components/options'

export interface MappingTargetNames {
  permissionGroups: Map<string, string>
  workspaces: Map<string, string>
}

export function describeScimMapping(
  mapping: ScimGroupMappingView,
  names: MappingTargetNames
): string {
  switch (mapping.targetKind) {
    case 'permission_group':
      return names.permissionGroups.get(mapping.permissionGroupId ?? '') ?? 'Permission group'
    case 'workspace': {
      const name = names.workspaces.get(mapping.workspaceId ?? '') ?? 'Workspace'
      const level = PERMISSION_OPTIONS.find((o) => o.value === mapping.permissionType)?.label
      return level ? `${name} · ${level}` : name
    }
    case 'org_role':
      return 'Organization admin'
  }
}

/** The write for a draft mapping, or `null` while it still lacks a target. */
export function buildScimMappingBody(
  groupId: string,
  targetKind: MappingTargetKind,
  targetId: string,
  permission: WorkspacePermission
): ScimGroupMappingBody | null {
  switch (targetKind) {
    case 'permission_group':
      return targetId ? { groupId, targetKind, permissionGroupId: targetId } : null
    case 'workspace':
      return targetId
        ? { groupId, targetKind, workspaceId: targetId, permissionType: permission }
        : null
    case 'org_role':
      return { groupId, targetKind, role: 'admin' }
  }
}

/** Mapping this group switches it permanently from everyone in its workspaces to selected members. */
export function mappingChangesAllMembersPolicy(group: PermissionGroup | undefined): boolean {
  return (
    group?.membershipMode === 'inherit' && group.memberCount === 0 && group.workspaces.length > 0
  )
}

/** Name matching would recreate this mapping after it is removed. */
export function automaticMatchWouldRemain(
  mapping: ScimGroupMappingView | undefined,
  autoMapByName: boolean,
  names: MappingTargetNames
): boolean {
  return (
    mapping?.targetKind === 'permission_group' &&
    autoMapByName &&
    (mapping.source === 'automatic' ||
      names.permissionGroups.get(mapping.permissionGroupId ?? '') === mapping.groupDisplayName)
  )
}

/** The confirmation sentence after the mapping's name, which depends on what it governs. */
export function removeMappingConsequence(
  mapping: ScimGroupMappingView | undefined,
  automaticMatchRemains: boolean
): string {
  return [
    mapping?.targetKind === 'permission_group'
      ? 'Members may keep workspace access under a different permission policy.'
      : 'Directory-managed access from this mapping will be withdrawn unless another mapping grants it. Existing manual access may remain.',
    ...(automaticMatchRemains
      ? [
          ' Name matching is enabled and can recreate this mapping. Turn off Match permission groups by name first to keep it removed.',
        ]
      : []),
  ].join('')
}
