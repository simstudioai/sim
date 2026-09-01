export const PERMISSION_GROUP_CONSTRAINTS = {
  organizationName: 'permission_group_organization_name_unique',
  organizationDefault: 'permission_group_organization_default_unique',
} as const

export const PERMISSION_GROUP_MEMBER_CONSTRAINTS = {
  groupUser: 'permission_group_member_group_user_unique',
} as const
