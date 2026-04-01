import { createSecretTool } from './create_secret'
import { deleteSecretTool } from './delete_secret'
import { getSecretTool } from './get_secret'
import { listSecretsTool } from './list_secrets'
import { updateSecretTool } from './update_secret'

export const secretsManagerGetSecretTool = getSecretTool
export const secretsManagerListSecretsTool = listSecretsTool
export const secretsManagerCreateSecretTool = createSecretTool
export const secretsManagerUpdateSecretTool = updateSecretTool
export const secretsManagerDeleteSecretTool = deleteSecretTool
