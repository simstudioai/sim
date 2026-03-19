import { createSecretTool } from '@/tools/infisical/create-secret'
import { deleteSecretTool } from '@/tools/infisical/delete-secret'
import { getSecretTool } from '@/tools/infisical/get-secret'
import { listSecretsTool } from '@/tools/infisical/list-secrets'
import { updateSecretTool } from '@/tools/infisical/update-secret'

export const infisicalListSecretsTool = listSecretsTool
export const infisicalGetSecretTool = getSecretTool
export const infisicalCreateSecretTool = createSecretTool
export const infisicalUpdateSecretTool = updateSecretTool
export const infisicalDeleteSecretTool = deleteSecretTool
