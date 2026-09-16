import type { ToolMetadata } from '@/tools/metadata'

export const ASSISTANT_TOOLS = new Set([
  'search_workspace',
  'read_document',
  'search_integration_tools',
  'call_integration_tool',
  'oauth_get_auth_link',
  'run_function',
])

const CREDENTIAL_PARAMS = new Set(['credential', 'credentialId', 'oauthCredential'])

/** Assistant uses the regular integration registry, with authentication supplied by the caller's account. */
export function isAssistantIntegrationTool(tool: ToolMetadata | undefined): boolean {
  if (!tool) return false
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
): void {
  if (!tool || !isAssistantIntegrationTool(tool)) {
    throw new Error('Assistant requires an integration that supports your own connected account.')
  }
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && !isAssistantIntegrationParameter(tool, name)) {
      throw new Error(
        `Assistant cannot supply the ${name} parameter. Authentication comes from your connected account.`
      )
    }
  }
  const selectors = [...CREDENTIAL_PARAMS]
    .map((name) => params[name])
    .filter((value) => value !== undefined)
  if (
    selectors.length === 0 ||
    selectors.some((value) => typeof value !== 'string' || !value.trim()) ||
    new Set(selectors).size !== 1
  ) {
    throw new Error('Select one of your connected accounts for this integration.')
  }
}
