'use client'

import { type ComponentType, useCallback, useMemo, useRef } from 'react'
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
import { useParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import {
  blockTypeToIconMap,
  formatIntegrationType,
  INTEGRATIONS,
  type Integration,
  resolveCredentialDisplay,
} from '@/lib/integrations'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
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
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useWorkspaceCredentials, type WorkspaceCredential } from '@/hooks/queries/credentials'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { usePermissionConfig } from '@/hooks/use-permission-config'

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
}

function IntegrationItem({
  blockType,
  slug,
  workspaceId,
  name,
  description,
  icon: Icon,
  unavailable = false,
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
      href={`/workspace/${workspaceId}/integrations/${slug}`}
      clickLabel={`Open ${name}`}
      navigable={!unavailable}
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
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const { integrationAvailability } = usePermissionConfig()

  const [{ category: selectedCategory, search: urlSearchTerm }, setIntegrationFilters] =
    useQueryStates(integrationsParsers, integrationsUrlKeys)

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

  const connectedItems = useMemo<ConnectedDisplayItem[]>(() => {
    return oauthCredentials.flatMap((credential) => {
      const display = resolveCredentialDisplay(credential)
      if (!display.service || !display.icon) return []
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
  }, [oauthCredentials])

  const setSelectedCategory = useCallback(
    (category: string) => {
      setIntegrationFilters({ category })
    },
    [setIntegrationFilters]
  )

  const categoryOptions = [
    ALL_CATEGORY,
    ...(connectedItems.length > 0 ? [CONNECTED_LABEL] : []),
    FEATURED_LABEL,
    ...ALL_CATEGORY_SECTIONS.map((section) => section.label),
  ]

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
      const items = FEATURED_INTEGRATIONS.filter(matchesSearch)
      return items.length > 0 ? [{ label: FEATURED_LABEL, integrations: items }] : []
    }

    const matchesCategory = (integration: Integration) =>
      isAllCategorySelected || integration.integrationType === selectedCategory

    // Featured is a curated home-row pin: hide it during search so results
    // are not duplicated between the Featured section and the category list.
    const featured = normalizedSearch ? [] : FEATURED_INTEGRATIONS.filter(matchesCategory)
    const featuredSection =
      featured.length > 0 ? [{ label: FEATURED_LABEL, integrations: featured }] : []

    if (isAllCategorySelected) {
      const rest = ALL_CATEGORY_SECTIONS.map((section) => ({
        label: section.label,
        integrations: section.integrations.filter(matchesSearch),
      })).filter((section) => section.integrations.length > 0)
      return [...featuredSection, ...rest]
    }

    const integrations = INTEGRATIONS.filter(matchesCategory)
      .filter(matchesSearch)
      .sort((a, b) => a.name.localeCompare(b.name))

    return [
      ...featuredSection,
      ...(integrations.length > 0 ? [{ label: selectedCategory, integrations }] : []),
    ]
  }, [
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
    Boolean(urlSearchTerm.trim() || !isAllCategorySelected) &&
    filteredCategorySections.length === 0 &&
    visibleConnectedItems.length === 0

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='integrations' workspaceId={workspaceId} />
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

            {filteredCategorySections.map((section) => (
              <IntegrationSection key={section.label} label={formatIntegrationType(section.label)}>
                {section.integrations.map((integration) => {
                  const Icon = blockTypeToIconMap[integration.type]
                  if (!Icon) return null
                  const availability = integrationAvailability.get(integration.type.toLowerCase())
                  const deploymentUnavailable =
                    availability?.state === 'unavailable' || availability?.state === 'misconfigured'
                  return (
                    <IntegrationItem
                      key={integration.type}
                      blockType={integration.type}
                      slug={integration.slug}
                      workspaceId={workspaceId}
                      name={integration.name}
                      description={integration.description}
                      icon={Icon}
                      unavailable={integration.authType === 'oauth' && deploymentUnavailable}
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
