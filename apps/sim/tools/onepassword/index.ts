import { createItemTool } from '@/tools/onepassword/create_item'
import { deleteItemTool } from '@/tools/onepassword/delete_item'
import { getItemTool } from '@/tools/onepassword/get_item'
import { getVaultTool } from '@/tools/onepassword/get_vault'
import { listItemsTool } from '@/tools/onepassword/list_items'
import { listVaultsTool } from '@/tools/onepassword/list_vaults'
import { replaceItemTool } from '@/tools/onepassword/replace_item'
import { resolveSecretTool } from '@/tools/onepassword/resolve_secret'
import { updateItemTool } from '@/tools/onepassword/update_item'

export const onepasswordCreateItemTool = createItemTool
export const onepasswordDeleteItemTool = deleteItemTool
export const onepasswordGetItemTool = getItemTool
export const onepasswordGetVaultTool = getVaultTool
export const onepasswordListItemsTool = listItemsTool
export const onepasswordListVaultsTool = listVaultsTool
export const onepasswordReplaceItemTool = replaceItemTool
export const onepasswordResolveSecretTool = resolveSecretTool
export const onepasswordUpdateItemTool = updateItemTool
