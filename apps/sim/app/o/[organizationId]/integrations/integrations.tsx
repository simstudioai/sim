'use client'

import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import { LiveMemberIntegrations } from '@/app/o/[organizationId]/integrations/live-member-integrations'
import { MemberIntegrationsList } from '@/app/o/[organizationId]/integrations/member-integrations-list'
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
  const { features } = useDeploymentShape()
  const { search } = useOrganizationPageFilters()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)

  return (
    <OrganizationPage
      title='Integrations'
      description={
        features.liveEnterpriseSearch
          ? 'Search documents, messages, and code from your connected apps'
          : 'Connect your accounts for Sim Search'
      }
      searchMode='expanded'
      searchPlaceholder='Search integrations'
      action={
        slackOnboarding && (
          <SlackSearchActions organizationId={organization.id} {...slackOnboarding} />
        )
      }
    >
      {!features.liveEnterpriseSearch && connectionRequest && (
        <SearchIntegrationConnection
          organizationId={organization.id}
          {...connectionRequest}
          controlId='integrations-link'
        />
      )}
      {features.liveEnterpriseSearch ? (
        <LiveMemberIntegrations organizationId={organization.id} search={sourceSearch} />
      ) : (
        <MemberIntegrationsList search={sourceSearch} />
      )}
    </OrganizationPage>
  )
}
