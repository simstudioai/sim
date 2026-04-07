import { addGroupMemberTool } from '@/tools/microsoft_ad/add_group_member'
import { createGroupTool } from '@/tools/microsoft_ad/create_group'
import { createUserTool } from '@/tools/microsoft_ad/create_user'
import { deleteGroupTool } from '@/tools/microsoft_ad/delete_group'
import { deleteUserTool } from '@/tools/microsoft_ad/delete_user'
import { getGroupTool } from '@/tools/microsoft_ad/get_group'
import { getUserTool } from '@/tools/microsoft_ad/get_user'
import { listGroupMembersTool } from '@/tools/microsoft_ad/list_group_members'
import { listGroupsTool } from '@/tools/microsoft_ad/list_groups'
import { listUsersTool } from '@/tools/microsoft_ad/list_users'
import { removeGroupMemberTool } from '@/tools/microsoft_ad/remove_group_member'
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
