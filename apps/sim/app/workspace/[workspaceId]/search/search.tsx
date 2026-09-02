'use client'

import { useRef, useState } from 'react'
import { ChipInput } from '@sim/emcn'
import { Search as SearchIcon } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { resolveCredentialDisplay } from '@/lib/integrations'
import { SEARCH_CONNECTORS, type SearchConnector } from '@/lib/sim-search/connectors'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { useScrollRestoration } from '@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration'
import { CONNECTED_LABEL } from '@/app/workspace/[workspaceId]/integrations/search-params'
import { useSearchCredentials } from '@/app/workspace/[workspaceId]/search/hooks/use-search-credentials'
import {
  connectorSearchParam,
  connectorSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/search/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import type { WorkspaceCredential } from '@/hooks/queries/credentials'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const CONNECTORS_LABEL = 'Sim Search Connectors'

interface ConnectorItemProps {
  connector: SearchConnector
  unavailable: boolean
  onConnect: (connector: SearchConnector) => void
}

/**
 * A connector row acts in place — it opens the connect modal — so it carries no
 * navigation chevron; only a connected credential leads to a page of its own.
 */
function ConnectorItem({ connector, unavailable, onConnect }: ConnectorItemProps) {
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={connector.blockType} icon={connector.meta.icon} />}
      title={connector.meta.name}
      description={
        unavailable
          ? 'Unavailable in this deployment. Contact your administrator.'
          : connector.meta.description
      }
      onClick={unavailable ? undefined : () => onConnect(connector)}
      clickLabel={`Connect ${connector.meta.name}`}
      disabled={unavailable}
    />
  )
}

interface ConnectedItemProps {
  credential: WorkspaceCredential
  workspaceId: string
}

function ConnectedItem({ credential, workspaceId }: ConnectedItemProps) {
  const display = resolveCredentialDisplay(credential)
  if (!display.icon) return null
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={display.blockType} icon={display.icon} />}
      title={credential.displayName}
      description={credential.description || display.subtitle}
      href={`/workspace/${workspaceId}/search/connected/${credential.id}`}
      clickLabel={`Open ${credential.displayName}`}
      navigable
    />
  )
}

/**
 * The Sim Search connector catalog: the viewer's own connections first, then
 * every connector a personal OAuth connection can power. Same shell and rows
 * as the Integrations page, minus its showcase and category filter — the
 * connector set is small enough that the search box alone narrows it. A
 * connector row opens the OAuth connect modal right here; the OAuth redirect
 * lands back on this page, where the return router reports the outcome.
 */
export function Search() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  useOAuthReturnRouter()
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const { integrationAvailability } = usePermissionConfig()
  const [connectTarget, setConnectTarget] = useState<SearchConnector | null>(null)

  const [searchTerm, setSearchTermParam] = useQueryState(connectorSearchParam.key, {
    ...connectorSearchParam.parser,
    ...connectorSearchUrlKeys,
  })
  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. Filtering below is cheap in-memory over a static list,
   * so it reads the instant value too.
   */
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)

  const { credentials, isPending: credentialsLoading } = useSearchCredentials(workspaceId)

  useScrollRestoration(scrollContainerRef, { ready: !credentialsLoading })

  const normalizedSearch = searchTerm.trim().toLowerCase()

  const visibleCredentials = normalizedSearch
    ? credentials.filter((credential) => {
        const display = resolveCredentialDisplay(credential)
        return [credential.displayName, credential.description ?? '', display.subtitle].some(
          (text) => text.toLowerCase().includes(normalizedSearch)
        )
      })
    : credentials

  const visibleConnectors = normalizedSearch
    ? SEARCH_CONNECTORS.filter(
        (connector) =>
          connector.meta.name.toLowerCase().includes(normalizedSearch) ||
          connector.meta.description.toLowerCase().includes(normalizedSearch)
      )
    : SEARCH_CONNECTORS

  const showNoResults =
    Boolean(normalizedSearch) && visibleCredentials.length === 0 && visibleConnectors.length === 0

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='search' workspaceId={workspaceId} />
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <ChipInput
            icon={SearchIcon}
            placeholder='Search connectors...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={credentialsLoading}
          />

          <div className='flex flex-col gap-7'>
            {visibleCredentials.length > 0 && (
              <IntegrationSection label={CONNECTED_LABEL}>
                {visibleCredentials.map((credential) => (
                  <ConnectedItem
                    key={credential.id}
                    credential={credential}
                    workspaceId={workspaceId}
                  />
                ))}
              </IntegrationSection>
            )}

            {visibleConnectors.length > 0 && (
              <IntegrationSection label={CONNECTORS_LABEL}>
                {visibleConnectors.map((connector) => {
                  /**
                   * The OAuth path specifically: an integration's `state` can
                   * read `limited` on a service-account-only deployment, but a
                   * connector authenticates with OAuth alone.
                   */
                  const availability = integrationAvailability.get(
                    connector.blockType.toLowerCase()
                  )
                  const unavailable = availability ? !availability.oauthAvailable : false
                  return (
                    <ConnectorItem
                      key={connector.type}
                      connector={connector}
                      unavailable={unavailable}
                      onConnect={setConnectTarget}
                    />
                  )
                })}
              </IntegrationSection>
            )}

            {showNoResults && (
              <SettingsEmptyState variant='inline'>
                No connectors found matching “{searchTerm}”
              </SettingsEmptyState>
            )}
          </div>
        </div>
      </div>
      {connectTarget && workspaceId && (
        <ConnectOAuthModal
          mode='connect'
          origin='integrations'
          open
          onOpenChange={(open) => {
            if (!open) setConnectTarget(null)
          }}
          workspaceId={workspaceId}
          providerId={connectTarget.providerId}
          requiredScopes={connectTarget.requiredScopes}
          serviceName={connectTarget.serviceName}
          serviceIcon={connectTarget.serviceIcon}
        />
      )}
    </div>
  )
}
