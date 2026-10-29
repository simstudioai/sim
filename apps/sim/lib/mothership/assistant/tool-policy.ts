import { OrchestrationError } from '@/lib/core/orchestration/types'
import { projectAssistantConnectedAccountTool } from '@/lib/mothership/assistant/connected-account-tool'
import type { ToolMetadata } from '@/tools/metadata'

export const ASSISTANT_TOOLS = new Set([
  'search_workspace',
  'read_document',
  'oauth_get_auth_link',
  'run_function',
])

const CREDENTIAL_PARAMS = new Set(['credential', 'credentialId', 'oauthCredential'])

/** Discovery and execution share the same operations and personal-account requirements. */
export function isAssistantIntegrationTool(tool: ToolMetadata | undefined): boolean {
  if (!tool || !tool.assistant) return false
  tool = projectAssistantConnectedAccountTool(tool)
  const tokenBinding = tool.personalToken
  const supportsToken =
    tokenBinding && tool.params[tokenBinding.tokenParam] && tool.params[tokenBinding.hostParam]
  return Boolean(
    (supportsToken ||
      (tool.oauth?.required &&
        tool.oauth.personalTokenSupported !== false &&
        tool.oauth.credentialKind !== 'service-account')) &&
      !Object.entries(tool.params).some(
        ([name, param]) =>
          param.required &&
          param.visibility === 'user-only' &&
          !CREDENTIAL_PARAMS.has(name) &&
          name !== tokenBinding?.tokenParam &&
          name !== tokenBinding?.hostParam
      )
  )
}

export function isAssistantIntegrationParameter(tool: ToolMetadata, name: string): boolean {
  tool = projectAssistantConnectedAccountTool(tool)
  if (CREDENTIAL_PARAMS.has(name)) return true
  if (name === tool.personalToken?.tokenParam || name === tool.personalToken?.hostParam)
    return false
  const param = tool.params[name]
  return Boolean(
    param &&
      param.visibility !== 'hidden' &&
      param.visibility !== 'user-only' &&
      name !== 'impersonateUserEmail' &&
      !tool.oauth?.authoritativeParams?.some((key) => key === name)
  )
}

/** Validates model arguments before file, secret, hosted-key, or provider resolution can run. */
export function assertAssistantIntegrationCall(
  tool: ToolMetadata | undefined,
  params: Record<string, unknown>
) {
  if (!tool?.assistant || !isAssistantIntegrationTool(tool)) {
    throw new OrchestrationError(
      'validation',
      'Assistant requires an integration that supports your own connected account.'
    )
  }
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && !isAssistantIntegrationParameter(tool, name)) {
      throw new OrchestrationError(
        'validation',
        'Assistant cannot supply authentication or unsupported parameters. Authentication comes from your connected account.'
      )
    }
  }
  const selectors = [...CREDENTIAL_PARAMS]
    .map((name) => params[name])
    .filter((value) => value !== undefined)
  const credentialId = selectors[0]
  if (
    typeof credentialId !== 'string' ||
    selectors.some((value) => typeof value !== 'string' || !value.trim()) ||
    new Set(selectors).size !== 1
  ) {
    throw new OrchestrationError(
      'validation',
      'Select one of your connected accounts for this integration.'
    )
  }
  return { credentialId, operation: tool.assistant }
}
