import { assumeRoleTool } from './assume_role'
import { assumeRoleWithSAMLTool } from './assume_role_with_saml'
import { assumeRoleWithWebIdentityTool } from './assume_role_with_web_identity'
import { getAccessKeyInfoTool } from './get_access_key_info'
import { getCallerIdentityTool } from './get_caller_identity'
import { getSessionTokenTool } from './get_session_token'

export const stsAssumeRoleTool = assumeRoleTool
export const stsAssumeRoleWithWebIdentityTool = assumeRoleWithWebIdentityTool
export const stsAssumeRoleWithSAMLTool = assumeRoleWithSAMLTool
export const stsGetCallerIdentityTool = getCallerIdentityTool
export const stsGetSessionTokenTool = getSessionTokenTool
export const stsGetAccessKeyInfoTool = getAccessKeyInfoTool

export * from './types'
