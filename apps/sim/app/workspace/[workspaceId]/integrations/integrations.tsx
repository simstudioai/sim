'use client'

import { type ComponentType, useCallback, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChipInput,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Search,
} from '@sim/emcn'
import { Lock } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import {
  blockTypeToIconMap,
  formatIntegrationType,
  INTEGRATIONS,
  type Integration,
  resolveCredentialDisplay,
} from '@/lib/integrations'
import { isIntegrationPermitted } from '@/lib/integrations/access'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components/integration-tabs-header'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { ShowcaseWithExplore } from '@/app/workspace/[workspaceId]/integrations/components/showcase-with-explore'
import { useScrollRestoration } from '@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration'
import {
  ALL_CATEGORY,
  CONNECTED_LABEL,
  FEATURED_LABEL,
  integrationsParsers,
  integrationsUrlKeys,
} from '@/app/workspace/[workspaceId]/integrations/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  PermissionAccessBoundary,
  useWorkspaceAccessRequestFeatures,
} from '@/ee/access-requests/components/permission-access-boundary'
import { RequestAccessModal } from '@/ee/access-requests/components/request-access-action'
import { useWorkspaceCredentials, type WorkspaceCredential } from '@/hooks/queries/credentials'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useIntegrationAccess } from '@/hooks/use-integration-access'

/** Slugs surfaced in the pinned Featured section, in display order. */
const FEATURED_SLUGS = ['slack', 'gmail', 'jira', 'github', 'google-sheets', 'hubspot'] as const

const FEATURED_INTEGRATIONS: readonly Integration[] = (() => {
  const bySlug = new Map(INTEGRATIONS.map((i) => [i.slug, i]))
  return FEATURED_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (i): i is Integration => i !== undefined
  )
})()

const ALL_CATEGORY_SECTIONS: readonly { label: string; integrations: Integration[] }[] = (() => {
  const grouped = new Map<string, Integration[]>()
  for (const integration of INTEGRATIONS) {
    if (!integration.integrationType) continue
    const bucket = grouped.get(integration.integrationType)
    if (bucket) bucket.push(integration)
    else grouped.set(integration.integrationType, [integration])
  }
  return Array.from(grouped, ([label, items]) => ({
    label,
    integrations: [...items].sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.label.localeCompare(b.label))
})()

interface IntegrationItemProps {
  blockType: string
  slug: string
  workspaceId: string
  name: string
  description?: string | null
  icon: ComponentType<{ className?: string }>
  unavailable?: boolean
  restricted?: boolean
  /** Set for an integration the viewer's policy restricts but lets them request. */
  onRequestAccess?: () => void
}

function IntegrationItem({
  blockType,
  slug,
  workspaceId,
  name,
  description,
  icon: Icon,
  unavailable = false,
  restricted = false,
  onRequestAccess,
}: IntegrationItemProps) {
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={blockType} icon={Icon} />}
      title={name}
      description={
        unavailable
          ? 'Unavailable in this deployment. Contact your administrator.'
          : description || undefined
      }
      badge={
        restricted ? (
          <Lock className='size-[14px] text-[var(--text-icon)]' aria-hidden />
        ) : undefined
      }
      href={onRequestAccess ? undefined : `/workspace/${workspaceId}/integrations/${slug}`}
      onClick={onRequestAccess}
      clickLabel={onRequestAccess ? `Request access to ${name}` : `Open ${name}`}
      navigable={!unavailable && !restricted}
      disabled={unavailable}
    />
  )
}

interface ConnectedDisplayItem {
  credential: WorkspaceCredential
  name: string
  description: string
  /**
   * Extra haystack for the search box: the service name plus every integration
   * the credential authenticates, so searching "jira" surfaces an Atlassian
   * service account even when the user has replaced its description.
   */
  searchText: string
  integrationType: string | null
  blockType: string
  slug: string
  icon: ComponentType<{ className?: string }>
}

interface ConnectedItemProps {
  href: string
  blockType: string
  name: string
  description: string
  icon: ComponentType<{ className?: string }>
}

function ConnectedItem({ href, blockType, name, description, icon: Icon }: ConnectedItemProps) {
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={blockType} icon={Icon} />}
      title={name}
      description={description}
      href={href}
      clickLabel={`Open ${name}`}
      navigable
    />
  )
}

export function Integrations() {
  return (
    <PermissionAccessBoundary configKey='hideIntegrationsTab'>
      <IntegrationsContent />
    </PermissionAccessBoundary>
  )
}

function IntegrationsContent() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const {
    getAccess,
    isReady: isAccessReady,
    isAvailabilityFetching,
    availabilityError,
    refetchAvailability,
  } = useIntegrationAccess(workspaceId)
  const accessRequestsEnabled = useWorkspaceAccessRequestFeatures().data?.enabled === true
  const [requestedIntegration, setRequestedIntegration] = useState<Integration | null>(null)

  const [{ category: urlCategory, search: urlSearchTerm }, setIntegrationFilters] = useQueryStates(
    integrationsParsers,
    integrationsUrlKeys
  )

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The raw value is written (trimming happens on read in
   * the filters below) so trailing spaces stay typable mid-word. Filtering is
   * cheap in-memory over a static list, so it reads the instant value too.
   */
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setIntegrationFilters({ search: value }, options)
  )

  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  useScrollRestoration(scrollContainerRef, { ready: !credentialsLoading })

  const oauthCredentials = useMemo(
    () =>
      credentials.filter(
        (c) => c.type === 'oauth' || c.type === 'service_account' || c.type === 'personal_token'
      ),
    [credentials]
  )

  /**
   * A credential is listed while one integration it authenticates is usable
   * here; one tied to no catalog integration is not governed by the allowlist.
   * Nothing is listed until the access policy has loaded.
   */
  const connectedItems = useMemo<ConnectedDisplayItem[]>(() => {
    if (!isAccessReady) return []
    return oauthCredentials.flatMap((credential) => {
      const display = resolveCredentialDisplay(credential)
      if (!display.service || !display.icon) return []
      const isUsable =
        display.coveredIntegrations.length === 0 ||
        display.coveredIntegrations.some((integration) =>
          isIntegrationPermitted(getAccess(integration.type))
        )
      if (!isUsable) return []
      return [
        {
          credential,
          name: credential.displayName,
          description: credential.description || display.subtitle,
          searchText: [
            display.familyName,
            display.service.name,
            ...display.coveredIntegrations.map((i) => i.name),
          ]
            .filter(Boolean)
            .join(' '),
          integrationType: display.integration?.integrationType ?? null,
          blockType: display.blockType,
          slug: display.integration?.slug ?? '',
          icon: display.icon,
        },
      ]
    })
  }, [oauthCredentials, isAccessReady, getAccess])

  /**
   * Usable and unconfigured integrations are listed, the latter as unavailable;
   * a requestable one stays listed as a locked row while requests are paused.
   * Nothing is listed until the access policy has loaded.
   */
  const isListed = useCallback(
    (blockType: string) => {
      const access = getAccess(blockType)
      return isIntegrationPermitted(access) || access === 'requestable'
    },
    [getAccess]
  )

  const listedFeatured = useMemo(
    () => FEATURED_INTEGRATIONS.filter((integration) => isListed(integration.type)),
    [isListed]
  )

  const listedCategorySections = useMemo(
    () =>
      ALL_CATEGORY_SECTIONS.flatMap((section) => {
        const integrations = section.integrations.filter((integration) =>
          isListed(integration.type)
        )
        return integrations.length > 0 ? [{ label: section.label, integrations }] : []
      }),
    [isListed]
  )

  const setSelectedCategory = useCallback(
    (category: string) => {
      setIntegrationFilters({ category })
    },
    [setIntegrationFilters]
  )

  const categoryOptions = [
    ALL_CATEGORY,
    ...(connectedItems.length > 0 ? [CONNECTED_LABEL] : []),
    ...(listedFeatured.length > 0 ? [FEATURED_LABEL] : []),
    ...listedCategorySections.map((section) => section.label),
  ]

  /**
   * A category the viewer's integration policy leaves empty is not offered, so a
   * link or a policy change that points at one falls back to All. Connected stays
   * selected while its rows load so the page does not flash All first.
   */
  const selectedCategory =
    categoryOptions.includes(urlCategory) ||
    (urlCategory === CONNECTED_LABEL && (credentialsLoading || !isAccessReady))
      ? urlCategory
      : ALL_CATEGORY

  const isAllCategorySelected = selectedCategory === ALL_CATEGORY
  const isFeaturedSelected = selectedCategory === FEATURED_LABEL
  const isConnectedSelected = selectedCategory === CONNECTED_LABEL

  const filteredCategorySections = useMemo(() => {
    // Connected-only view: integration sections are suppressed entirely.
    if (isConnectedSelected) return []

    const normalizedSearch = urlSearchTerm.trim().toLowerCase()
    const matchesSearch = (integration: Integration) =>
      !normalizedSearch ||
      integration.name.toLowerCase().includes(normalizedSearch) ||
      integration.description.toLowerCase().includes(normalizedSearch)

    if (isFeaturedSelected) {
      const items = listedFeatured.filter(matchesSearch)
      return items.length > 0 ? [{ label: FEATURED_LABEL, integrations: items }] : []
    }

    const matchesCategory = (integration: Integration) =>
      isAllCategorySelected || integration.integrationType === selectedCategory

    // Featured is a curated home-row pin: hide it during search so results
    // are not duplicated between the Featured section and the category list.
    const featured = normalizedSearch ? [] : listedFeatured.filter(matchesCategory)
    const featuredSection =
      featured.length > 0 ? [{ label: FEATURED_LABEL, integrations: featured }] : []

    const categorySections = listedCategorySections
      .filter((section) => isAllCategorySelected || section.label === selectedCategory)
      .map((section) => ({
        label: section.label,
        integrations: section.integrations.filter(matchesSearch),
      }))
      .filter((section) => section.integrations.length > 0)

    return [...featuredSection, ...categorySections]
  }, [
    listedFeatured,
    listedCategorySections,
    isAllCategorySelected,
    isConnectedSelected,
    isFeaturedSelected,
    urlSearchTerm,
    selectedCategory,
  ])

  const visibleConnectedItems = useMemo(() => {
    // Featured-only view: Connected is suppressed (mirror behavior of the
    // Featured-only branch above, which renders only the Featured section).
    if (isFeaturedSelected) return []

    const normalizedSearch = urlSearchTerm.trim().toLowerCase()
    return connectedItems.filter((item) => {
      const matchesCategory =
        isAllCategorySelected || isConnectedSelected || item.integrationType === selectedCategory
      if (!matchesCategory) return false
      if (!normalizedSearch) return true
      return (
        item.name.toLowerCase().includes(normalizedSearch) ||
        item.description.toLowerCase().includes(normalizedSearch) ||
        item.searchText.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [
    connectedItems,
    isAllCategorySelected,
    isConnectedSelected,
    isFeaturedSelected,
    urlSearchTerm,
    selectedCategory,
  ])

  const showNoResults =
    isAccessReady &&
    Boolean(urlSearchTerm.trim() || !isAllCategorySelected) &&
    filteredCategorySections.length === 0 &&
    visibleConnectedItems.length === 0

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='integrations' workspaceId={workspaceId} />
      {requestedIntegration && accessRequestsEnabled && (
        <RequestAccessModal
          key={requestedIntegration.type}
          scope={{ kind: 'workspace', workspaceId }}
          target={{ kind: 'integration', id: requestedIntegration.type }}
          label={requestedIntegration.name}
          onClose={() => setRequestedIntegration(null)}
        />
      )}
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <ShowcaseWithExplore prompt='Explain the integrations in Sim and what I should connect.' />
          <div className='flex items-center gap-2'>
            <ChipInput
              icon={Search}
              className='min-w-0 flex-1'
              placeholder='Search integrations...'
              value={urlSearchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={credentialsLoading}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type='button' className={chipVariants({ variant: 'filled' })}>
                  <span className='text-[var(--text-body)]'>
                    {selectedCategory === ALL_CATEGORY
                      ? selectedCategory
                      : formatIntegrationType(selectedCategory)}
                  </span>
                  <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='min-w-[160px]'>
                {categoryOptions.map((category) => (
                  <DropdownMenuItem key={category} onSelect={() => setSelectedCategory(category)}>
                    {category === ALL_CATEGORY ? category : formatIntegrationType(category)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className='flex flex-col gap-7'>
            {visibleConnectedItems.length > 0 && (
              <IntegrationSection label={CONNECTED_LABEL}>
                {visibleConnectedItems.map((item) => (
                  <ConnectedItem
                    key={item.credential.id}
                    href={`/workspace/${workspaceId}/integrations/connected/${item.credential.id}`}
                    blockType={item.blockType}
                    name={item.name}
                    description={item.description}
                    icon={item.icon}
                  />
                ))}
              </IntegrationSection>
            )}

            {availabilityError && (
              <SettingsQueryErrorState
                variant='inline'
                error={availabilityError}
                fallback='Unable to load integrations'
                isRetrying={isAvailabilityFetching}
                onRetry={() => void refetchAvailability()}
              />
            )}

            {filteredCategorySections.map((section) => (
              <IntegrationSection key={section.label} label={formatIntegrationType(section.label)}>
                {section.integrations.map((integration) => {
                  const Icon = blockTypeToIconMap[integration.type]
                  if (!Icon) return null
                  const access = getAccess(integration.type)
                  return (
                    <IntegrationItem
                      key={integration.type}
                      blockType={integration.type}
                      slug={integration.slug}
                      workspaceId={workspaceId}
                      name={integration.name}
                      description={integration.description}
                      icon={Icon}
                      unavailable={access === 'unconfigured'}
                      restricted={access === 'requestable'}
                      onRequestAccess={
                        access === 'requestable' && accessRequestsEnabled
                          ? () => setRequestedIntegration(integration)
                          : undefined
                      }
                    />
                  )
                })}
              </IntegrationSection>
            ))}

            {showNoResults && (
              <SettingsEmptyState variant='inline'>
                {urlSearchTerm.trim()
                  ? `No integrations found matching “${urlSearchTerm}”`
                  : 'No integrations in this category'}
              </SettingsEmptyState>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
