'use client'

import { type ComponentType, type CSSProperties, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, chipVariants, cn, Expandable, ExpandableContent } from '@sim/emcn'
import { Shuffle, Table } from '@sim/emcn/icons'
import { randomFloat } from '@sim/utils/random'
import { stripVersionSuffix } from '@sim/utils/string'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { usePostHog } from 'posthog-js/react'
import { GmailIcon, SlackIcon } from '@/components/icons'
import {
  getAllBlockMeta,
  INTEGRATIONS,
  type OAuthServiceMatch,
  resolveOAuthServiceForIntegration,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations'
import { captureEvent } from '@/lib/posthog/client'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { getBareIconStyle } from '@/blocks/icon-color'
import type { ModuleTag } from '@/blocks/types'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useOAuthConnections } from '@/hooks/queries/oauth/oauth-connections'
import { useTablesList } from '@/hooks/queries/tables'

type Icon = ComponentType<{ className?: string; style?: CSSProperties }>

type Action =
  | { kind: 'prompt'; id: string; label: string; prompt: string; icon: Icon }
  | { kind: 'integration'; id: string; label: string; icon: Icon; slug: string }

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
  icon: Icon
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
        icon: template.icon as Icon,
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

/**
 * Weighted sampling without replacement. Each pick's probability is
 * proportional to its weight, so shuffles stay fresh while staying relevant.
 */
function weightedSample<T>(pool: readonly T[], n: number, weightOf: (item: T) => number): T[] {
  const remaining = pool.map((item) => ({ item, weight: Math.max(weightOf(item), 0) }))
  const out: T[] = []
  while (out.length < n && remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0)
    if (total <= 0) break
    let roll = randomFloat() * total
    const index = remaining.findIndex((entry) => {
      roll -= entry.weight
      return roll <= 0
    })
    const [picked] = remaining.splice(index === -1 ? remaining.length - 1 : index, 1)
    out.push(picked.item)
  }
  return out
}

const EMPTY_CREDENTIALS: NonNullable<ReturnType<typeof useWorkspaceCredentials>['data']> = []
const EMPTY_SERVICES: NonNullable<ReturnType<typeof useOAuthConnections>['data']> = []

type ServiceInfo = NonNullable<ReturnType<typeof useOAuthConnections>['data']>[number]

function toPromptAction(c: Candidate): Action {
  return { kind: 'prompt', id: c.id, label: c.label, prompt: c.prompt, icon: c.icon }
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

interface SuggestedActionsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedActions({ onSelectPrompt }: SuggestedActionsProps) {
  const t = useTranslations('auto')
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const posthog = usePostHog()

  const { data: credentials = EMPTY_CREDENTIALS } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })
  const { data: services = EMPTY_SERVICES } = useOAuthConnections()
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId, {
    enabled: Boolean(workspaceId),
  })

  const [expanded, setExpanded] = useState(true)
  /**
   * Collapsible animations are enabled only after the first user toggle, so
   * the initially-open, server-rendered panel appears at full height on first
   * paint instead of replaying the open animation and shifting the input
   * above it.
   */
  const [animationsEnabled, setAnimationsEnabled] = useState(false)
  /** Incremented by the shuffle control to re-roll the weighted sample. */
  const [shuffleNonce, setShuffleNonce] = useState(0)
  /**
   * OAuth connect modal target. Setting this opens the modal; setting it back
   * to `null` (via `onOpenChange(false)`) closes it. Mirrors the local-state
   * pattern used by the integrations detail page.
   */
  const [oauthTarget, setOAuthTarget] = useState<OAuthServiceMatch | null>(null)

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

  /**
   * Personalized suggestions, re-sampled whenever signals resolve or the user
   * shuffles. Falls back to {@link INITIAL_ACTIONS} until the credential and
   * service queries have loaded (and stays there for users with no
   * connections, unless they shuffle), so first paint never flashes.
   */
  const actions = useMemo(() => {
    const personalized = services.length > 0 && connectedProviders.size > 0
    if (!personalized && shuffleNonce === 0) return INITIAL_ACTIONS
    return computeActions(services, signals)
  }, [connectedProviders, services, signals, shuffleNonce])

  const handleSelect = (action: Action, position: number) => {
    captureEvent(posthog, 'suggested_action_clicked', {
      workspace_id: workspaceId,
      kind: action.kind,
      action_id: action.id,
      label: action.label,
      position,
      connected_provider_count: connectedProviders.size,
    })
    if (action.kind === 'prompt') {
      onSelectPrompt(action.prompt)
      return
    }
    const match = resolveOAuthServiceForSlug(action.slug)
    if (match) setOAuthTarget(match)
  }

  const handleShuffle = () => {
    captureEvent(posthog, 'suggested_actions_shuffled', {
      workspace_id: workspaceId,
      connected_provider_count: connectedProviders.size,
    })
    setShuffleNonce((n) => n + 1)
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
    <div className='mx-auto mt-7 w-full max-w-[48rem]'>
      <div className='flex items-center justify-between'>
        <button
          type='button'
          onClick={handleToggleExpanded}
          aria-expanded={expanded}
          className='flex items-center gap-2'
        >
          <span className='text-[var(--text-muted)] text-small'>{t('suggested_actions')}</span>
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
        <button
          type='button'
          onClick={handleShuffle}
          aria-label={t('shuffle_suggested_actions')}
          aria-hidden={!expanded}
          tabIndex={expanded ? undefined : -1}
          className={cn(
            chipVariants({ flush: true }),
            '-mr-2 gap-1.5 transition-opacity duration-150 ease-out motion-reduce:transition-none',
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <span className='-mt-px text-[var(--text-muted)] text-small'>{t('shuffle')}</span>
          <Shuffle className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
        </button>
      </div>
      <Expandable expanded={expanded}>
        <ExpandableContent className={cn('mt-2', !animationsEnabled && '!animate-none')}>
          <div className='flex flex-col'>
            {actions.map((action, i) => {
              const Icon = action.icon
              return (
                <button
                  key={action.id}
                  type='button'
                  onClick={() => handleSelect(action, i)}
                  className={cn(
                    'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors hover-hover:bg-[var(--surface-5)]',
                    i > 0 && 'border-t'
                  )}
                >
                  <Icon
                    className='size-[16px] flex-shrink-0 text-[var(--text-icon)]'
                    style={getBareIconStyle(Icon)}
                  />
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
