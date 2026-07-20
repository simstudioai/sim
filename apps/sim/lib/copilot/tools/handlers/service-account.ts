import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  listServiceAccountIntegrationNames,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import {
  CONNECT_MODE,
  CONNECT_QUERY_PARAM,
} from '@/app/workspace/[workspaceId]/integrations/connect-route'

/**
 * Returns a link that opens the integration detail page with the
 * service-account connect modal already open, so the user supplies the key
 * material in Sim's own form. The agent never receives or relays the secret —
 * it only hands over the link, which it surfaces as a `<credential>` link tag.
 */
export async function executeServiceAccountGetSetupLink(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const providerName = String(rawParams.providerName || rawParams.provider_name || '')
  const baseUrl = getBaseUrl()

  try {
    if (!context.workspaceId || !context.userId) {
      throw new Error('workspaceId and userId are required to generate a service account link')
    }

    // Connecting a credential mutates the workspace, so gate on write here
    // rather than letting the user discover they lack access after clicking.
    await ensureWorkspaceAccess(context.workspaceId, context.userId, 'write')

    const match = resolveServiceAccountIntegration(providerName)
    if (!match) {
      throw new Error(
        `"${providerName}" has no service account flow. Integrations that do: ` +
          `${listServiceAccountIntegrationNames().join(', ')}. Use oauth_get_auth_link instead.`
      )
    }

    const url = new URL(`${baseUrl}/workspace/${context.workspaceId}/integrations/${match.slug}`)
    url.searchParams.set(CONNECT_QUERY_PARAM, CONNECT_MODE.serviceAccount)

    return {
      success: true,
      output: {
        message: `Service account setup available for ${match.serviceName}.`,
        instructions:
          `Emit <credential>{"type":"service_account","provider":"${match.providerId}"}</credential> ` +
          `to open the ${match.serviceName} setup form directly in this chat. Only fall back to ` +
          `setup_url when you cannot render a tag (headless/MCP). The form collects the ` +
          `credential — never ask the user to paste key material into chat.`,
        provider: match.serviceName,
        // The OAuth provider value, NOT the service-account provider id — both
        // the tag renderer and the link renderer resolve display metadata from
        // this, and a service-account id resolves to whichever family member is
        // registered first: `google-service-account` labels Google Sheets "Gmail".
        providerId: match.providerId,
        serviceAccountProviderId: match.serviceAccountProviderId,
        /** Headless fallback only; interactive chat should emit the tag. */
        setup_url: url.toString(),
      },
    }
  } catch (err) {
    const workspaceUrl = context.workspaceId
      ? `${baseUrl}/workspace/${context.workspaceId}/integrations`
      : `${baseUrl}/workspace`
    return {
      success: false,
      error: toError(err).message,
      output: {
        message: `Could not generate a service account setup link for ${providerName}. Browse the integrations page instead.`,
        setup_url: workspaceUrl,
        error: toError(err).message,
      },
    }
  }
}
