'use client'

import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page'
import { LiveMemberIntegrations } from '@/app/o/[organizationId]/integrations/live-member-integrations'
import { SlackSearchActions } from '@/app/o/[organizationId]/integrations/slack-search-actions'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { useDebounce } from '@/hooks/use-debounce'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'

interface OrganizationIntegrationsProps {
  connectionRequest?: { target: SearchConnectionTarget; userId: string }
  slackOnboarding?: { token: string; userId: string }
}

export function OrganizationIntegrations({
  slackOnboarding,
  connectionRequest,
}: OrganizationIntegrationsProps = {}) {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const { organization } = useOrganizationContext()
  const { search } = useOrganizationPageFilters()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)

  return (
    <LiveMemberIntegrations
      organizationId={organization.id}
      search={sourceSearch}
      navigationSearch={search}
      action={
        slackOnboarding && (
          <SlackSearchActions organizationId={organization.id} {...slackOnboarding} />
        )
      }
      intro={
        connectionRequest && (
          <SearchIntegrationConnection
            organizationId={organization.id}
            {...connectionRequest}
            controlId='integrations-link'
          />
        )
      }
    />
  )
}
