export * from '@/tools/iam/types'

import { addUserToGroupTool } from '@/tools/iam/add_user_to_group'
import { attachRolePolicyTool } from '@/tools/iam/attach_role_policy'
import { attachUserPolicyTool } from '@/tools/iam/attach_user_policy'
import { createAccessKeyTool } from '@/tools/iam/create_access_key'
import { createRoleTool } from '@/tools/iam/create_role'
import { createUserTool } from '@/tools/iam/create_user'
import { deleteAccessKeyTool } from '@/tools/iam/delete_access_key'
import { deleteRoleTool } from '@/tools/iam/delete_role'
import { deleteUserTool } from '@/tools/iam/delete_user'
import { detachRolePolicyTool } from '@/tools/iam/detach_role_policy'
import { detachUserPolicyTool } from '@/tools/iam/detach_user_policy'
import { getPolicyTool } from '@/tools/iam/get_policy'
import { getRoleTool } from '@/tools/iam/get_role'
import { getUserTool } from '@/tools/iam/get_user'
import { listAccessKeysTool } from '@/tools/iam/list_access_keys'
import { listAttachedRolePoliciesTool } from '@/tools/iam/list_attached_role_policies'
import { listAttachedUserPoliciesTool } from '@/tools/iam/list_attached_user_policies'
import { listGroupsTool } from '@/tools/iam/list_groups'
import { listPoliciesTool } from '@/tools/iam/list_policies'
import { listRolesTool } from '@/tools/iam/list_roles'
import { listUsersTool } from '@/tools/iam/list_users'
import { removeUserFromGroupTool } from '@/tools/iam/remove_user_from_group'
import { simulatePrincipalPolicyTool } from '@/tools/iam/simulate_principal_policy'
import { updateAccessKeyTool } from '@/tools/iam/update_access_key'

export const iamListUsersTool = listUsersTool
export const iamGetUserTool = getUserTool
export const iamCreateUserTool = createUserTool
export const iamDeleteUserTool = deleteUserTool
export const iamListRolesTool = listRolesTool
export const iamGetRoleTool = getRoleTool
export const iamCreateRoleTool = createRoleTool
export const iamDeleteRoleTool = deleteRoleTool
export const iamAttachUserPolicyTool = attachUserPolicyTool
export const iamDetachUserPolicyTool = detachUserPolicyTool
export const iamAttachRolePolicyTool = attachRolePolicyTool
export const iamDetachRolePolicyTool = detachRolePolicyTool
export const iamListPoliciesTool = listPoliciesTool
export const iamGetPolicyTool = getPolicyTool
export const iamCreateAccessKeyTool = createAccessKeyTool
export const iamDeleteAccessKeyTool = deleteAccessKeyTool
export const iamListAccessKeysTool = listAccessKeysTool
export const iamUpdateAccessKeyTool = updateAccessKeyTool
export const iamListGroupsTool = listGroupsTool
export const iamAddUserToGroupTool = addUserToGroupTool
export const iamRemoveUserFromGroupTool = removeUserFromGroupTool
export const iamListAttachedRolePoliciesTool = listAttachedRolePoliciesTool
export const iamListAttachedUserPoliciesTool = listAttachedUserPoliciesTool
export const iamSimulatePrincipalPolicyTool = simulatePrincipalPolicyTool
