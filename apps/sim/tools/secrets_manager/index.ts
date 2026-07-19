import { createSecretTool } from './create_secret'
import { deleteSecretTool } from './delete_secret'
import { describeSecretTool } from './describe_secret'
import { getSecretTool } from './get_secret'
import { listSecretsTool } from './list_secrets'
import { restoreSecretTool } from './restore_secret'
import { rotateSecretTool } from './rotate_secret'
import { tagResourceTool } from './tag_resource'
import { untagResourceTool } from './untag_resource'
import { updateSecretTool } from './update_secret'

export const secretsManagerGetSecretTool = getSecretTool
export const secretsManagerListSecretsTool = listSecretsTool
export const secretsManagerCreateSecretTool = createSecretTool
export const secretsManagerUpdateSecretTool = updateSecretTool
export const secretsManagerDeleteSecretTool = deleteSecretTool
export const secretsManagerDescribeSecretTool = describeSecretTool
export const secretsManagerTagResourceTool = tagResourceTool
export const secretsManagerUntagResourceTool = untagResourceTool
export const secretsManagerRestoreSecretTool = restoreSecretTool
export const secretsManagerRotateSecretTool = rotateSecretTool
