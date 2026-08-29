import { z } from 'zod'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  FILE_SHARE_AUTH_TYPES,
  type PermissionGroupConfig,
  type PermissionGroupConfigKey,
  parsePermissionGroupConfig,
  permissionGroupWriteShape,
} from '@/lib/permission-groups/fields'

export {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  FILE_SHARE_AUTH_TYPES,
  type PermissionGroupConfig,
  type PermissionGroupConfigKey,
  parsePermissionGroupConfig,
}

export const PERMISSION_GROUP_CONSTRAINTS = {
  organizationName: 'permission_group_organization_name_unique',
  organizationDefault: 'permission_group_organization_default_unique',
} as const

export const PERMISSION_GROUP_MEMBER_CONSTRAINTS = {
  groupUser: 'permission_group_member_group_user_unique',
} as const

/**
 * The config a create or update body may carry: every key optional, so a caller
 * patches only what it means to change. The route merges the result over the
 * group's stored config, which is what heals a row written before a key
 * existed.
 */
export const permissionGroupConfigSchema = z.object(permissionGroupWriteShape)
