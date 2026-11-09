'use client'

import type { SaveSearchPersonalCredentialBody } from '@/lib/api/contracts/search-personal-credentials'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { slackSearchOnboardingPath } from '@/lib/slack-search/onboarding'
import { useSavePersonalSearchCredential } from '@/hooks/queries/personal-search-integrations'
import {
  useRetrySlackSearchOnboarding,
  useSlackSearchOnboarding,
} from '@/hooks/queries/slack-search-onboarding'
import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'

/** A connection a chat or link asked for, offered ahead of the Integrations inventory. */
export function useSearchConnectionRequest(
  organizationId: string,
  userId: string,
  target: SearchConnectionTarget
) {
  return useSearchIntegrationConnection({
    organizationId,
    userId,
    target,
    controlId: 'integrations-link',
  })
}

/** A saved account the member adds by hand, or replaces under its current name. */
export interface SavedSearchConnection {
  providerId: SaveSearchPersonalCredentialBody['providerId']
  credentialId?: string
  displayName?: string
}

/**
 * Saves a member's hand-entered Search account through the member-owned save operation, as the
 * legacy saved-credential dialog did, with the fields the shared service-account form collects.
 * Null when the provider has no service to title the dialog with.
 */
export function useSavedSearchCredential(
  organizationId: string,
  connection: SavedSearchConnection
) {
  const save = useSavePersonalSearchCredential()
  const service = getServiceConfigByProviderId(connection.providerId)
  if (!service) return null
  return {
    serviceName: service.name,
    pending: save.isPending,
    submit: async (fields: Record<string, string>) =>
      (
        await save.mutateAsync({
          organizationId,
          providerId: connection.providerId,
          credentialId: connection.credentialId,
          apiToken: fields.apiToken,
          domain: fields.domain,
          providerWorkspaceId: fields.providerWorkspaceId,
          clientId: fields.clientId,
          clientSecret: fields.clientSecret,
          orgId: fields.orgId,
          displayName: fields.displayName,
          description: fields.description,
        })
      ).credentialId,
  }
}

/**
 * Where a Slack onboarding link stands on this organization's integrations page: unread, failed,
 * belonging to another organization or not yet ready to connect here, or back in the Slack thread.
 */
export function useSlackSearchHandoff(organizationId: string, token: string, userId: string) {
  const status = useSlackSearchOnboarding(token, userId)
  const retry = useRetrySlackSearchOnboarding(userId)
  const data = status.data
  if (!data) return { stage: 'unread' as const, error: status.error?.message ?? null }
  if (!('organizationId' in data) || data.organizationId !== organizationId)
    return { stage: 'elsewhere' as const, finishHref: slackSearchOnboardingPath(token) }
  return {
    stage: 'here' as const,
    checking: status.isFetching,
    check: () => void status.refetch(),
    checkError: status.isRefetchError ? status.error.message : null,
    slackUrl: data.slackUrl,
    ready: data.status === 'ready',
    retried: data.status === 'retried' || retry.isSuccess,
    retrying: retry.isPending,
    retry: () => retry.mutate({ token }),
    retryError: retry.isError ? retry.error.message : null,
  }
}
