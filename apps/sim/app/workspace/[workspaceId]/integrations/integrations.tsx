'use client'

import { type ComponentType, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { debounce, useQueryStates } from 'nuqs'
import {
  ArrowRight,
  ChevronDown,
  ChipInput,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Search,
} from '@/components/emcn'
import {
  blockTypeToIconMap,
  formatIntegrationType,
  INTEGRATIONS,
  type Integration,
} from '@/lib/integrations'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/integrations/components/integration-tabs-header'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { ShowcaseWithExplore } from '@/app/workspace/[workspaceId]/integrations/components/showcase-with-explore'
import {
  ALL_CATEGORY,
  CONNECTED_LABEL,
  FEATURED_LABEL,
  integrationsParsers,
  integrationsUrlKeys,
} from '@/app/workspace/[workspaceId]/integrations/search-params'
import { useWorkspaceCredentials, type WorkspaceCredential } from '@/hooks/queries/credentials'
import { useTranslations } from 'next-intl'

/** Debounce window for `search` URL writes; the input itself stays instant. */
const SEARCH_DEBOUNCE_MS = 300 as const

/** Slugs surfaced in the pinned Featured section, in display order. */
const FEATURED_SLUGS = ['slack', 'gmail', 'jira', 'github', 'google-sheets', 'hubspot'] as const

const LINK_ROW_CLASSES =
  'flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
const LINK_ROW_TITLE_CLASSES = 'truncate text-[14px] text-[var(--text-body)]'
const LINK_ROW_SUBTITLE_CLASSES = 'truncate text-[12px] text-[var(--text-muted)]'
const LINK_ROW_ARROW_CLASSES = 'size-4 flex-shrink-0 text-[var(--text-icon)]'

const FEATURED_INTEGRATIONS: readonly Integration[] = (() => {
  const bySlug = new Map(INTEGRATIONS.map((i) => [i.slug, i]))
  return FEATURED_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (i): i is Integration => i !== undefined
  )
})()

/** Lookup integration metadata by OAuth service display name (case-insensitive). */
const INTEGRATION_BY_LOWER_NAME: ReadonlyMap<string, Integration> = new Map(
  INTEGRATIONS.map((i) => [i.name.toLowerCase(), i])
)

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
}

function IntegrationItem({
  blockType,
  slug,
  workspaceId,
  name,
  description,
  icon: Icon,
}: IntegrationItemProps) {
  return (
    <Link href={`/workspace/${workspaceId}/integrations/${slug}`} className={LINK_ROW_CLASSES}>
      <IntegrationTile blockType={blockType} icon={Icon} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className={LINK_ROW_TITLE_CLASSES}>{name}</span>
        {description && <span className={LINK_ROW_SUBTITLE_CLASSES}>{description}</span>}
      </div>
      <ArrowRight className={LINK_ROW_ARROW_CLASSES} />
    </Link>
  )
}

interface ConnectedDisplayItem {
  credential: WorkspaceCredential
  name: string
  description: string
  serviceName: string
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
    <Link href={href} className={LINK_ROW_CLASSES}>
      <IntegrationTile blockType={blockType} icon={Icon} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <span className={LINK_ROW_TITLE_CLASSES}>{name}</span>
        <span className={LINK_ROW_SUBTITLE_CLASSES}>{description}</span>
      </div>
      <ArrowRight className={LINK_ROW_ARROW_CLASSES} />
    </Link>
  )
}

export function Integrations() {
  const t = useTranslations('auto')
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const [{ category: selectedCategory, search: urlSearchTerm }, setIntegrationFilters] =
    useQueryStates(integrationsParsers, integrationsUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. Filtering below is cheap in-memory over a static list,
   * so it reads the instant value too.
   */
  const setSearchTerm = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      const next = trimmed.length > 0 ? trimmed : null
      setIntegrationFilters(
        { search: next },
        next === null ? undefined : { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) }
      )
    },
    [setIntegrationFilters]
  )

  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  const oauthCredentials = useMemo(
    () => credentials.filter((c) => c.type === 'oauth' || c.type === 'service_account'),
    [credentials]
  )

  const connectedItems = useMemo<ConnectedDisplayItem[]>(() => {
    return oauthCredentials.flatMap((credential) => {
      if (!credential.providerId) return []
      const service = getServiceConfigByProviderId(credential.providerId)
      if (!service) return []
      const integration = INTEGRATION_BY_LOWER_NAME.get(service.name.toLowerCase())
      return [
        {
          credential,
          name: credential.displayName,
          description: credential.description || `${service.name} integration`,
          serviceName: service.name,
          integrationType: integration?.integrationType ?? null,
          blockType: integration?.type ?? '',
          slug: integration?.slug ?? '',
          icon: service.icon as ComponentType<{ className?: string }>,
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
        item.serviceName.toLowerCase().includes(normalizedSearch)
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
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <ShowcaseWithExplore prompt='Explain the integrations in Sim and what I should connect.' />
          <div className='flex items-center gap-2'>
            <ChipInput
              icon={Search}
              className='min-w-0 flex-1'
              placeholder={t('search_integrations')}
              value={urlSearchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={credentialsLoading}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type='button' className={chipVariants({ variant: 'filled', flush: true })}>
                  <span className='text-[var(--text-body)]'>
                    {selectedCategory === ALL_CATEGORY
                      ? selectedCategory
                      : formatIntegrationType(selectedCategory)}
                  </span>
                  <ChevronDown className='h-[7px] w-[9px] text-[var(--text-icon)]' />
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
                  return (
                    <IntegrationItem
                      key={integration.type}
                      blockType={integration.type}
                      slug={integration.slug}
                      workspaceId={workspaceId}
                      name={integration.name}
                      description={integration.description}
                      icon={Icon}
                    />
                  )
                })}
              </IntegrationSection>
            ))}

            {showNoResults && (
              <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                {urlSearchTerm.trim()
                  ? `No integrations found matching “${urlSearchTerm}”`
                  : 'No integrations in this category'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
