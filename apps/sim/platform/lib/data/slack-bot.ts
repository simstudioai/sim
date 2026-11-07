import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  buildSlackAppCreationUrl,
  buildSlackCustomBotRequestUrl,
  getSlackAgentDescriptionError,
  getSlackAppNameError,
  SLACK_APP_CREATION_URL_MAX_LENGTH,
} from '@/lib/integrations/slack-manifest'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
} from '@/triggers/slack/capabilities'

/**
 * An organization bot serves Search, so it takes Slack's default capabilities and no slash
 * commands: those route to workflows, which belong to a workspace.
 */
const ORGANIZATION_CAPABILITIES = new Set(
  [...SLACK_CAPABILITIES, SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY]
    .filter((capability) => capability.defaultChecked)
    .map((capability) => capability.id)
)

export interface SlackBotIdentity {
  displayName: string
  description: string
}

export interface SlackBotSecrets {
  botToken: string
  signingSecret: string
}

/** The Slack app to create for this credential, or why it cannot be built. */
function slackApp(credentialId: string, { displayName, description }: SlackBotIdentity) {
  const error = getSlackAppNameError(displayName) ?? getSlackAgentDescriptionError(description)
  if (error) return { error }
  const createAppUrl = buildSlackAppCreationUrl(
    JSON.stringify(
      buildSlackManifest(ORGANIZATION_CAPABILITIES, {
        appName: displayName.trim(),
        webhookUrl: buildSlackCustomBotRequestUrl(credentialId),
        description,
        slashCommands: [],
        managedUserAuthorization: getSlackManagedUserAuthorizationManifestConfig(getBaseUrl()),
      })
    )
  )
  return createAppUrl.length > SLACK_APP_CREATION_URL_MAX_LENGTH
    ? { error: 'This app configuration is too large to open in Slack. Shorten the description.' }
    : { createAppUrl }
}

/**
 * A custom Slack bot owned by the organization. The credential id is reserved before the app
 * exists, because Slack posts to a Request URL that embeds it; reconnecting keeps the id, so the
 * app's Request URL and the credential's shares survive a secret rotation. Secrets pass straight
 * to the mutation and are never held here.
 */
export function useSlackBotConnection(organizationId: string, reconnectCredentialId?: string) {
  const [credentialId, setCredentialId] = useState(() => reconnectCredentialId ?? generateId())
  const create = useCreateScopedCredential()
  const update = useUpdateScopedCredential()
  return {
    credentialId,
    requestUrl: buildSlackCustomBotRequestUrl(credentialId),
    pending: create.isPending || update.isPending,
    slackApp: (identity: SlackBotIdentity) => slackApp(credentialId, identity),
    async save(identity: SlackBotIdentity, secrets: SlackBotSecrets) {
      const fields = {
        organizationId,
        signingSecret: secrets.signingSecret.trim(),
        botToken: secrets.botToken.trim(),
        displayName: identity.displayName.trim() || undefined,
        description: identity.description.trim() || undefined,
      }
      if (reconnectCredentialId) {
        await update.mutateAsync({ ...fields, credentialId })
        return credentialId
      }
      await create.mutateAsync({
        ...fields,
        type: 'service_account',
        providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
        id: credentialId,
      })
      setCredentialId(generateId())
      return credentialId
    },
  }
}
