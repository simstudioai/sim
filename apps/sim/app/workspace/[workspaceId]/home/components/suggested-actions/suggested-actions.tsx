'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, cn, Expandable, ExpandableContent } from '@sim/emcn'
import { Table } from '@sim/emcn/icons'
import { stripVersionSuffix } from '@sim/utils/string'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { GmailIcon, SlackIcon } from '@/components/icons'
import {
  INTEGRATIONS,
  resolveOAuthServiceForIntegration,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations'
import { captureEvent } from '@/lib/posthog/client'
import { isSearchConnectorAvailable } from '@/lib/sim-search/connectors'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { computeConnectorActions } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/connector-actions'
import type {
  Action,
  ActionIcon,
  OAuthConnectTarget,
} from '@/app/workspace/[workspaceId]/home/components/suggested-actions/types'
import { weightedSample } from '@/app/workspace/[workspaceId]/home/components/suggested-actions/weighted-sample'
import { useSearchCredentials } from '@/app/workspace/[workspaceId]/search/hooks/use-search-credentials'
import { BrandIcon } from '@/blocks/brand-icon'
import { getAllBlockMeta } from '@/blocks/registry'
import type { ModuleTag } from '@/blocks/types'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useOAuthConnections } from '@/hooks/queries/oauth/oauth-connections'
import { useTablesList } from '@/hooks/queries/tables'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { type MothershipMode, useMothershipModeStore } from '@/stores/mothership-mode/store'

/** Lookup integration slug by OAuth service display name (case-insensitive). */
const SLUG_BY_LOWER_NAME: ReadonlyMap<string, string> = new Map(
  INTEGRATIONS.map((i) => [i.name.toLowerCase(), i.slug])
)

/** Lookup base block type by catalog slug, for the connect-row popularity weight. */
const TYPE_BY_SLUG: ReadonlyMap<string, string> = new Map(
  INTEGRATIONS.map((i) => [i.slug, stripVersionSuffix(i.type)])
)

/**
 * A scored suggestion candidate derived from the block template catalog (plus
 * a few generic table starters). `providerId` is set when the owning block is
 * an OAuth integration, enabling connectivity-aware scoring.
 */
interface Candidate {
  id: string
  /** Diversity key — at most one suggestion per block is ever shown. */
  blockType: string
  label: string
  prompt: string
  icon: ActionIcon
  modules: readonly ModuleTag[]
  featured: boolean
  popular: boolean
  providerId: string | null
}

/** Generic table starters for workspaces without integration context. */
const TABLE_STARTERS: readonly Candidate[] = [
  { label: 'Create a CRM with sample data', prompt: 'Create a CRM with sample data.' },
  { label: 'Build a project tracker', prompt: 'Build a project tracker table.' },
  { label: 'Create a content calendar', prompt: 'Create a content calendar table.' },
  { label: 'Build an expense tracker', prompt: 'Build an expense tracker table.' },
  { label: 'Create a bug tracker', prompt: 'Create a bug tracker table.' },
].map(({ label, prompt }, i) => ({
  id: `table-starter-${i}`,
  blockType: `table-starter-${i}`,
  label,
  prompt,
  icon: Table,
  modules: ['tables'] as const,
  featured: false,
  popular: true,
  providerId: null,
}))

/**
 * The full suggestion pool, built once at module load from the curated block
 * template catalog (`getAllBlockMeta`). Each block's templates are hand-written
 * catalog prompts; the owning block links a template to its integration so
 * connectivity can inform scoring. Blocks without a catalog entry (internal
 * blocks) are skipped. Catalog types may carry version suffixes (`gmail_v2`)
 * while meta-registry keys are base types (`gmail`), so the integration map
 * is keyed by both forms.
 */
const CANDIDATES: readonly Candidate[] = (() => {
  const integrationByType = new Map(
    INTEGRATIONS.flatMap((i) => [[i.type, i] as const, [stripVersionSuffix(i.type), i] as const])
  )
  const out: Candidate[] = [...TABLE_STARTERS]
  for (const [blockType, meta] of Object.entries(getAllBlockMeta())) {
    const integration = integrationByType.get(blockType)
    if (!integration) continue
    const providerId = resolveOAuthServiceForIntegration(integration)?.providerId ?? null
    for (const [i, template] of (meta.templates ?? []).entries()) {
      out.push({
        id: `${blockType}-${i}`,
        blockType,
        label: template.title,
        prompt: template.prompt,
        icon: template.icon as ActionIcon,
        modules: template.modules,
        featured: template.featured ?? false,
        popular: template.category === 'popular',
        providerId,
      })
    }
  }
  return out
})()

/** Template count per block type — a data-driven popularity proxy for connect rows. */
const TEMPLATE_COUNT_BY_TYPE: ReadonlyMap<string, number> = (() => {
  const counts = new Map<string, number>()
  for (const c of CANDIDATES) {
    if (c.providerId) counts.set(c.blockType, (counts.get(c.blockType) ?? 0) + 1)
  }
  return counts
})()

interface Signals {
  connectedProviders: ReadonlySet<string>
  hasTables: boolean
  hasKnowledgeBases: boolean
}

/**
 * Scores a candidate against workspace signals. Connected-provider prompts get
 * the largest boost — they are runnable immediately, with no OAuth detour —
 * while unconnected OAuth prompts are discounted (but kept, since they still
 * teach capability). Resource gaps nudge the mix: workspaces without tables
 * see more table starters; workspaces that already run knowledge bases see
 * fewer "create a knowledge base" prompts.
 */
function scoreCandidate(c: Candidate, signals: Signals): number {
  let weight = 1
  if (c.featured) weight *= 3
  if (c.popular) weight *= 1.5
  if (c.providerId) {
    weight *= signals.connectedProviders.has(c.providerId) ? 4 : 0.4
  }
  if (c.modules.includes('tables') && !signals.hasTables) weight *= 1.5
  if (c.modules.includes('knowledge-base') && signals.hasKnowledgeBases) weight *= 0.6
  return weight
}

const EMPTY_CREDENTIALS: NonNullable<ReturnType<typeof useWorkspaceCredentials>['data']> = []
const EMPTY_SERVICES: NonNullable<ReturnType<typeof useOAuthConnections>['data']> = []

type ServiceInfo = NonNullable<ReturnType<typeof useOAuthConnections>['data']>[number]

function toPromptAction(c: Candidate): Action {
  return { kind: 'prompt', id: c.id, label: c.label, icon: c.icon, prompt: c.prompt }
}

function toIntegrationAction(service: ServiceInfo, slug: string): Action {
  return {
    kind: 'integration',
    id: `integrate-${service.providerId}`,
    label: `Integrate with ${service.name}`,
    icon: service.icon,
    slug,
  }
}

/**
 * Builds a fresh set of four suggested actions: "Integrate with X" rows for
 * unconnected services (weighted by how many catalog templates the service
 * has — a data-driven popularity proxy), then prompt rows weighted by
 * {@link scoreCandidate}. At most one prompt per block keeps the set diverse.
 * Workspaces with at least one connection get a single connect row and three
 * prompts; fresh workspaces get two of each.
 */
function computeActions(services: readonly ServiceInfo[], signals: Signals): Action[] {
  const connectCandidates = services.flatMap((s) => {
    if (signals.connectedProviders.has(s.providerId)) return []
    const slug = SLUG_BY_LOWER_NAME.get(s.name.toLowerCase())
    return slug ? [{ service: s, slug }] : []
  })
  const connectCount = signals.connectedProviders.size === 0 ? 2 : 1
  const integrations = weightedSample(
    connectCandidates,
    connectCount,
    ({ slug }) => (TEMPLATE_COUNT_BY_TYPE.get(TYPE_BY_SLUG.get(slug) ?? '') ?? 0) + 1
  ).map(({ service, slug }) => toIntegrationAction(service, slug))

  const scored = CANDIDATES.map((c) => ({ c, weight: scoreCandidate(c, signals) })).filter(
    (entry) => entry.weight > 0
  )
  const prompts: Action[] = []
  const usedBlockTypes = new Set<string>()
  while (prompts.length < 4 - integrations.length) {
    const available = scored.filter((entry) => !usedBlockTypes.has(entry.c.blockType))
    const [pick] = weightedSample(available, 1, (entry) => entry.weight)
    if (!pick) break
    usedBlockTypes.add(pick.c.blockType)
    prompts.push(toPromptAction(pick.c))
  }

  return [...integrations, ...prompts]
}

/**
 * Initial actions rendered on first paint, before OAuth/credentials queries
 * resolve. For users with no connections this is also the final result, so the
 * section never flashes. Users with existing connections briefly see this
 * before the personalized recompute replaces it.
 */
const INITIAL_ACTIONS: Action[] = [
  {
    kind: 'integration',
    id: 'integrate-slack',
    label: 'Integrate with Slack',
    icon: SlackIcon,
    slug: 'slack',
  },
  {
    kind: 'integration',
    id: 'integrate-gmail',
    label: 'Integrate with Gmail',
    icon: GmailIcon,
    slug: 'gmail',
  },
  toPromptAction(TABLE_STARTERS[0]),
  ...CANDIDATES.filter((c) => c.blockType === 'github' && c.featured)
    .slice(0, 1)
    .map(toPromptAction),
]

/** Section heading per composer mode — Search reads as a connect-your-sources list. */
const HEADINGS: Record<MothershipMode, string> = {
  build: 'Suggested actions',
  search: 'Connect Sim Search',
}

interface SuggestedActionsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedActions({ onSelectPrompt }: SuggestedActionsProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()
  const mode = useMothershipModeStore((state) => state.mode)
  const { integrationAvailability } = usePermissionConfig()

  const { data: credentials = EMPTY_CREDENTIALS } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })
  const { data: services = EMPTY_SERVICES } = useOAuthConnections()
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId, {
    enabled: Boolean(workspaceId),
  })
  const { credentials: searchCredentials, isPending: searchCredentialsPending } =
    useSearchCredentials(workspaceId)

  const [expanded, setExpanded] = useState(true)
  /**
   * Collapsible animations are enabled only after the first user toggle, so
   * the initially-open, server-rendered panel appears at full height on first
   * paint instead of replaying the open animation and shifting the input
   * above it.
   */
  const [animationsEnabled, setAnimationsEnabled] = useState(false)
  /**
   * OAuth connect modal target. Setting this opens the modal; setting it back
   * to `null` (via `onOpenChange(false)`) closes it. Mirrors the local-state
   * pattern used by the integrations detail page.
   */
  const [oauthTarget, setOAuthTarget] = useState<OAuthConnectTarget | null>(null)

  const connectedProviders = useMemo(
    () =>
      new Set(
        credentials
          .filter((c) => c.type === 'oauth' || c.type === 'service_account')
          .map((c) => c.providerId)
          .filter((id): id is string => Boolean(id))
      ),
    [credentials]
  )

  const signals = useMemo<Signals>(
    () => ({
      connectedProviders,
      hasTables: tables.length > 0,
      hasKnowledgeBases: knowledgeBases.length > 0,
    }),
    [connectedProviders, tables.length, knowledgeBases.length]
  )

  const connectedSearchProviders = useMemo(
    () =>
      new Set(
        searchCredentials
          .map((credential) => credential.providerId)
          .filter((providerId): providerId is string => Boolean(providerId))
      ),
    [searchCredentials]
  )

  /**
   * Each mode's list is memoized on its own inputs alone, so switching modes —
   * or the other mode's signals settling — never re-samples it.
   *
   * Search lists connectors to attach, and waits for the viewer's credentials:
   * sampling against an empty set would list connected providers and then
   * reshuffle when the query lands. Build lists personalized suggestions,
   * re-sampled whenever signals resolve, and falls back to
   * {@link INITIAL_ACTIONS} until the credential and service queries have loaded
   * — and stays there for users with no connections — so first paint never
   * flashes. The store's default mode is Build, so the server render never
   * shows the sampled Search list.
   */
  const searchActions = useMemo(
    () =>
      searchCredentialsPending
        ? []
        : computeConnectorActions(connectedSearchProviders, (connector) =>
            isSearchConnectorAvailable(connector, integrationAvailability)
          ),
    [searchCredentialsPending, connectedSearchProviders, integrationAvailability]
  )
  const buildActions = useMemo(() => {
    const personalized = services.length > 0 && connectedProviders.size > 0
    if (!personalized) return INITIAL_ACTIONS
    return computeActions(services, signals)
  }, [connectedProviders, services, signals])
  const actions = mode === 'search' ? searchActions : buildActions

  const handleSelect = (action: Action, position: number) => {
    captureEvent(posthog, 'suggested_action_clicked', {
      workspace_id: workspaceId,
      kind: action.kind,
      action_id: action.id,
      label: action.label,
      position,
      connected_provider_count:
        action.kind === 'connector' ? connectedSearchProviders.size : connectedProviders.size,
    })
    if (action.kind === 'prompt') {
      onSelectPrompt(action.prompt)
      return
    }
    const target =
      action.kind === 'connector' ? action.target : resolveOAuthServiceForSlug(action.slug)
    if (target) setOAuthTarget(target)
  }

  const handleToggleExpanded = () => {
    captureEvent(posthog, 'suggested_actions_toggled', {
      workspace_id: workspaceId,
      expanded: !expanded,
    })
    setAnimationsEnabled(true)
    setExpanded((prev) => !prev)
  }

  return (
    <div className='group/suggested mx-auto mt-7 w-full max-w-chat'>
      {/* Full width so the whole line toggles, not just the label and chevron. */}
      <button
        type='button'
        onClick={handleToggleExpanded}
        aria-expanded={expanded}
        className='group/toggle flex w-full cursor-pointer items-center gap-2'
      >
        <span className='text-[var(--text-muted)] text-caption'>{HEADINGS[mode]}</span>
        {/*
         * Revealed by hovering anywhere in the section — the group sits on the
         * section wrapper rather than this row, so the action rows below arm it just
         * as the header does. Focus is keyed off the toggle instead, the only element
         * here that can hold it, and matters because globals clear focus outlines.
         * One transition covers the fade and the rotation so the two cannot drift
         * apart. Mirrors the sidebar's section headers.
         */}
        <ChevronDown
          className={cn(
            'size-[14px] flex-shrink-0 text-[var(--text-icon)] opacity-0 transition-[opacity,transform] duration-150',
            'group-hover/suggested:opacity-100 group-focus-visible/toggle:opacity-100',
            !expanded && '-rotate-90'
          )}
        />
      </button>
      <Expandable expanded={expanded}>
        <ExpandableContent className={cn(!animationsEnabled && '!animate-none')}>
          {/* 6px, matching a sidebar section header to its first item — both headers
              are an 18px box around 12px text, so equal padding reads as equal
              distance. Padding an inner wrapper rather than the animated element:
              `collapsible-up`/`-down` interpolate height alone, so a margin here
              would hold its full value through the close and then vanish on unmount,
              snapping the content below up. */}
          <div className='flex flex-col pt-1.5'>
            {actions.map((action, i) => {
              const Icon = action.icon
              return (
                <button
                  key={action.id}
                  type='button'
                  onClick={() => handleSelect(action, i)}
                  className={cn(
                    'flex items-center gap-2 border-[var(--border)] px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-5)]',
                    i > 0 && 'border-t'
                  )}
                >
                  <BrandIcon icon={Icon} className='size-[16px] flex-shrink-0' />
                  <span className='flex-1 truncate text-[var(--text-body)] text-sm'>
                    {action.label}
                  </span>
                  <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
                </button>
              )
            })}
          </div>
        </ExpandableContent>
      </Expandable>
      {oauthTarget && workspaceId && (
        <ConnectOAuthModal
          mode='connect'
          origin='integrations'
          open
          onOpenChange={(open) => {
            if (!open) setOAuthTarget(null)
          }}
          workspaceId={workspaceId}
          providerId={oauthTarget.providerId}
          requiredScopes={oauthTarget.requiredScopes}
          serviceName={oauthTarget.serviceName}
          serviceIcon={oauthTarget.serviceIcon}
        />
      )}
    </div>
  )
}
