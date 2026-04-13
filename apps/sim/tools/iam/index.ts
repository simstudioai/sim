import { addUserToGroupTool } from './add_user_to_group'
import { attachRolePolicyTool } from './attach_role_policy'
import { attachUserPolicyTool } from './attach_user_policy'
import { createAccessKeyTool } from './create_access_key'
import { createRoleTool } from './create_role'
import { createUserTool } from './create_user'
import { deleteAccessKeyTool } from './delete_access_key'
import { deleteRoleTool } from './delete_role'
import { deleteUserTool } from './delete_user'
import { detachRolePolicyTool } from './detach_role_policy'
import { detachUserPolicyTool } from './detach_user_policy'
import { getRoleTool } from './get_role'
import { getUserTool } from './get_user'
import { listGroupsTool } from './list_groups'
import { listPoliciesTool } from './list_policies'
import { listRolesTool } from './list_roles'
import { listUsersTool } from './list_users'
import { removeUserFromGroupTool } from './remove_user_from_group'

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
export const iamCreateAccessKeyTool = createAccessKeyTool
export const iamDeleteAccessKeyTool = deleteAccessKeyTool
export const iamListGroupsTool = listGroupsTool
export const iamAddUserToGroupTool = addUserToGroupTool
export const iamRemoveUserFromGroupTool = removeUserFromGroupTool
