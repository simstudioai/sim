import { createSecretTool } from '@/tools/infisical/create_secret'
import { deleteSecretTool } from '@/tools/infisical/delete_secret'
import { getSecretTool } from '@/tools/infisical/get_secret'
import { listSecretsTool } from '@/tools/infisical/list_secrets'
import { updateSecretTool } from '@/tools/infisical/update_secret'

export const infisicalListSecretsTool = listSecretsTool
export const infisicalGetSecretTool = getSecretTool
export const infisicalCreateSecretTool = createSecretTool
export const infisicalUpdateSecretTool = updateSecretTool
export const infisicalDeleteSecretTool = deleteSecretTool

export * from './types'
