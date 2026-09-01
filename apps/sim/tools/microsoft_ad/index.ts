import { addDirectoryRoleMemberTool } from '@/tools/microsoft_ad/add_directory_role_member'
import { addGroupMemberTool } from '@/tools/microsoft_ad/add_group_member'
import { addUserAppRoleAssignmentTool } from '@/tools/microsoft_ad/add_user_app_role_assignment'
import { assignLicenseTool } from '@/tools/microsoft_ad/assign_license'
import { createGroupTool } from '@/tools/microsoft_ad/create_group'
import { createUserTool } from '@/tools/microsoft_ad/create_user'
import { deleteGroupTool } from '@/tools/microsoft_ad/delete_group'
import { deleteUserTool } from '@/tools/microsoft_ad/delete_user'
import { getConditionalAccessPolicyTool } from '@/tools/microsoft_ad/get_conditional_access_policy'
import { getDeviceTool } from '@/tools/microsoft_ad/get_device'
import { getGroupTool } from '@/tools/microsoft_ad/get_group'
import { getUserTool } from '@/tools/microsoft_ad/get_user'
import { listAuthenticationMethodsTool } from '@/tools/microsoft_ad/list_authentication_methods'
import { listConditionalAccessPoliciesTool } from '@/tools/microsoft_ad/list_conditional_access_policies'
import { listDevicesTool } from '@/tools/microsoft_ad/list_devices'
import { listDirectoryAuditsTool } from '@/tools/microsoft_ad/list_directory_audits'
import { listDirectoryRoleMembersTool } from '@/tools/microsoft_ad/list_directory_role_members'
import { listDirectoryRolesTool } from '@/tools/microsoft_ad/list_directory_roles'
import { listGroupMembersTool } from '@/tools/microsoft_ad/list_group_members'
import { listGroupsTool } from '@/tools/microsoft_ad/list_groups'
import { listServicePrincipalAppRoleAssignmentsTool } from '@/tools/microsoft_ad/list_service_principal_app_role_assignments'
import { listServicePrincipalsTool } from '@/tools/microsoft_ad/list_service_principals'
import { listSignInsTool } from '@/tools/microsoft_ad/list_sign_ins'
import { listSubscribedSkusTool } from '@/tools/microsoft_ad/list_subscribed_skus'
import { listUserAppRoleAssignmentsTool } from '@/tools/microsoft_ad/list_user_app_role_assignments'
import { listUserDevicesTool } from '@/tools/microsoft_ad/list_user_devices'
import { listUserLicensesTool } from '@/tools/microsoft_ad/list_user_licenses'
import { listUsersTool } from '@/tools/microsoft_ad/list_users'
import { removeDirectoryRoleMemberTool } from '@/tools/microsoft_ad/remove_directory_role_member'
import { removeGroupMemberTool } from '@/tools/microsoft_ad/remove_group_member'
import { removeUserAppRoleAssignmentTool } from '@/tools/microsoft_ad/remove_user_app_role_assignment'
import { resetPasswordTool } from '@/tools/microsoft_ad/reset_password'
import { revokeSignInSessionsTool } from '@/tools/microsoft_ad/revoke_sign_in_sessions'
import { setPasswordTool } from '@/tools/microsoft_ad/set_password'
import { updateGroupTool } from '@/tools/microsoft_ad/update_group'
import { updateUserTool } from '@/tools/microsoft_ad/update_user'

export const microsoftAdListUsersTool = listUsersTool
export const microsoftAdGetUserTool = getUserTool
export const microsoftAdCreateUserTool = createUserTool
export const microsoftAdUpdateUserTool = updateUserTool
export const microsoftAdDeleteUserTool = deleteUserTool
export const microsoftAdListGroupsTool = listGroupsTool
export const microsoftAdGetGroupTool = getGroupTool
export const microsoftAdCreateGroupTool = createGroupTool
export const microsoftAdUpdateGroupTool = updateGroupTool
export const microsoftAdDeleteGroupTool = deleteGroupTool
export const microsoftAdListGroupMembersTool = listGroupMembersTool
export const microsoftAdAddGroupMemberTool = addGroupMemberTool
export const microsoftAdRemoveGroupMemberTool = removeGroupMemberTool
export const microsoftAdAssignLicenseTool = assignLicenseTool
export const microsoftAdListUserLicensesTool = listUserLicensesTool
export const microsoftAdListSubscribedSkusTool = listSubscribedSkusTool
export const microsoftAdRevokeSignInSessionsTool = revokeSignInSessionsTool
export const microsoftAdSetPasswordTool = setPasswordTool
export const microsoftAdResetPasswordTool = resetPasswordTool
export const microsoftAdListAuthenticationMethodsTool = listAuthenticationMethodsTool
export const microsoftAdListSignInsTool = listSignInsTool
export const microsoftAdListDirectoryAuditsTool = listDirectoryAuditsTool
export const microsoftAdListUserAppRoleAssignmentsTool = listUserAppRoleAssignmentsTool
export const microsoftAdAddUserAppRoleAssignmentTool = addUserAppRoleAssignmentTool
export const microsoftAdRemoveUserAppRoleAssignmentTool = removeUserAppRoleAssignmentTool
export const microsoftAdListServicePrincipalsTool = listServicePrincipalsTool
export const microsoftAdListServicePrincipalAppRoleAssignmentsTool =
  listServicePrincipalAppRoleAssignmentsTool
export const microsoftAdListDirectoryRolesTool = listDirectoryRolesTool
export const microsoftAdListDirectoryRoleMembersTool = listDirectoryRoleMembersTool
export const microsoftAdAddDirectoryRoleMemberTool = addDirectoryRoleMemberTool
export const microsoftAdRemoveDirectoryRoleMemberTool = removeDirectoryRoleMemberTool
export const microsoftAdListDevicesTool = listDevicesTool
export const microsoftAdGetDeviceTool = getDeviceTool
export const microsoftAdListUserDevicesTool = listUserDevicesTool
export const microsoftAdListConditionalAccessPoliciesTool = listConditionalAccessPoliciesTool
export const microsoftAdGetConditionalAccessPolicyTool = getConditionalAccessPolicyTool
