'use client'

import {
  type ComponentType,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useParams } from 'next/navigation'
import {
  ArrowRight,
  ChevronDown,
  chipVariants,
  Expandable,
  ExpandableContent,
} from '@/components/emcn'
import { Shuffle, Table } from '@/components/emcn/icons'
import {
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  HubspotIcon,
  JiraIcon,
  LinearIcon,
  NotionIcon,
  SalesforceIcon,
  SlackIcon,
} from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  INTEGRATIONS,
  type OAuthServiceMatch,
  resolveOAuthServiceForSlug,
} from '@/lib/integrations'
import { ConnectOAuthModal } from '@/app/workspace/[workspaceId]/components/connect-oauth-modal'
import { getBareIconStyle } from '@/blocks/icon-color'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useOAuthConnections } from '@/hooks/queries/oauth/oauth-connections'

type Icon = ComponentType<{ className?: string; style?: CSSProperties }>

type Action =
  | { kind: 'prompt'; id: string; label: string; prompt: string; icon: Icon }
  | { kind: 'integration'; id: string; label: string; icon: Icon; slug: string }

/** Lookup integration slug by OAuth service display name (case-insensitive). */
const SLUG_BY_LOWER_NAME: ReadonlyMap<string, string> = new Map(
  INTEGRATIONS.map((i) => [i.name.toLowerCase(), i.slug])
)

interface PromptOption {
  id: string
  label: string
  prompt: string
  icon: Icon
  providerId?: string
}

const TABLE_PROMPTS: readonly PromptOption[] = [
  {
    id: 'crm',
    label: 'Create a CRM with sample data',
    prompt: 'Create a CRM with sample data.',
    icon: Table,
  },
  {
    id: 'project-tracker',
    label: 'Build a project tracker',
    prompt: 'Build a project tracker table.',
    icon: Table,
  },
  {
    id: 'content-calendar',
    label: 'Create a content calendar',
    prompt: 'Create a content calendar table.',
    icon: Table,
  },
  {
    id: 'expense-tracker',
    label: 'Build an expense tracker',
    prompt: 'Build an expense tracker table.',
    icon: Table,
  },
  {
    id: 'bug-tracker',
    label: 'Create a bug tracker',
    prompt: 'Create a bug tracker table.',
    icon: Table,
  },
]

const INTEGRATION_PROMPTS: readonly PromptOption[] = [
  {
    id: 'gmail-auto-reply',
    providerId: 'gmail',
    icon: GmailIcon,
    label: 'Build an auto-reply email agent',
    prompt:
      'Create a workflow that reads my Gmail inbox, identifies emails that need a response, and drafts contextual replies for each one. Schedule it to run every hour.',
  },
  {
    id: 'slack-qa',
    providerId: 'slack',
    icon: SlackIcon,
    label: 'Build a Slack Q&A bot',
    prompt:
      'Create a knowledge base connected to my Notion workspace. Then build a workflow that monitors Slack channels for questions and answers them with source citations.',
  },
  {
    id: 'jira-search',
    providerId: 'jira',
    icon: JiraIcon,
    label: 'Search across Jira tickets',
    prompt:
      'Create a knowledge base connected to my Jira project so all tickets and resolutions are searchable. Then build an agent I can ask questions about past work.',
  },
  {
    id: 'notion-search',
    providerId: 'notion',
    icon: NotionIcon,
    label: 'Search across Notion',
    prompt:
      'Create a knowledge base connected to my Notion workspace. Then build an agent I can ask questions and get answers with page links.',
  },
  {
    id: 'github-pr-review',
    providerId: 'github',
    icon: GithubIcon,
    label: 'Review pull requests automatically',
    prompt:
      'Build a workflow that reviews new GitHub pull requests against my style guide and posts review comments with specific suggestions.',
  },
  {
    id: 'meeting-prep',
    providerId: 'google_calendar',
    icon: GoogleCalendarIcon,
    label: 'Prep for meetings automatically',
    prompt:
      'Create an agent that checks my Google Calendar each morning, researches every attendee, and prepares a brief for each meeting.',
  },
  {
    id: 'linear-search',
    providerId: 'linear',
    icon: LinearIcon,
    label: 'Search across Linear issues',
    prompt:
      'Create a knowledge base connected to my Linear workspace. Then build an agent I can ask questions about past issues and decisions.',
  },
  {
    id: 'gmail-triage',
    providerId: 'gmail',
    icon: GmailIcon,
    label: 'Triage your email inbox',
    prompt:
      'Build a workflow that scans my Gmail inbox hourly, categorizes emails by urgency, drafts replies for routine messages, and Slacks me a prioritized summary.',
  },
  {
    id: 'hubspot-search',
    providerId: 'hubspot',
    icon: HubspotIcon,
    label: 'Search HubSpot deals',
    prompt:
      'Create a knowledge base connected to my HubSpot account. Then build an agent I can ask questions about deals, contacts, and activity.',
  },
  {
    id: 'salesforce-search',
    providerId: 'salesforce',
    icon: SalesforceIcon,
    label: 'Search across Salesforce',
    prompt:
      'Create a knowledge base connected to my Salesforce account. Then build an agent I can ask questions about deals, contacts, and notes.',
  },
]

const EMPTY_CREDENTIALS: NonNullable<ReturnType<typeof useWorkspaceCredentials>['data']> = []
const EMPTY_SERVICES: NonNullable<ReturnType<typeof useOAuthConnections>['data']> = []

type ServiceInfo = NonNullable<ReturnType<typeof useOAuthConnections>['data']>[number]

/** Returns up to `n` random items from the array (Fisher–Yates). */
function sample<T>(arr: readonly T[], n: number): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, n)
}

function toPromptAction(option: PromptOption): Action {
  return {
    kind: 'prompt',
    id: option.id,
    label: option.label,
    prompt: option.prompt,
    icon: option.icon,
  }
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
 * Builds a fresh randomized set of suggested actions. Because it samples via
 * {@link sample}, each call yields a new ordering — this powers both the initial
 * personalization effect and the shuffle control. Users with connected services
 * get integration suggestions for services they have not yet connected; everyone
 * else falls back to sampling the table and integration prompt pools so the set
 * still changes on shuffle.
 */
function computeActions(
  services: readonly ServiceInfo[],
  connectedProviders: ReadonlySet<string>
): Action[] {
  const candidates = services.flatMap((s) => {
    if (connectedProviders.has(s.providerId)) return []
    const slug = SLUG_BY_LOWER_NAME.get(s.name.toLowerCase())
    return slug ? [{ service: s, slug }] : []
  })
  const integrations = sample(candidates, 2).map(({ service, slug }) =>
    toIntegrationAction(service, slug)
  )

  const integrationPool = INTEGRATION_PROMPTS.filter(
    (p) => !p.providerId || !connectedProviders.has(p.providerId)
  )
  const promptCount = 4 - integrations.length
  const [tablePick] = sample(TABLE_PROMPTS, 1)
  const integrationPicks = sample(
    integrationPool.length > 0 ? integrationPool : INTEGRATION_PROMPTS,
    promptCount - 1
  )
  const prompts = sample([tablePick, ...integrationPicks].map(toPromptAction), promptCount)

  return [...integrations, ...prompts]
}

/**
 * Initial actions rendered on first paint, before OAuth/credentials queries resolve.
 * For users with no connections this is also the final result, so the section never
 * flashes. Users with existing connections briefly see this before the effect below
 * replaces it with personalized integrations.
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
  toPromptAction(TABLE_PROMPTS.find((p) => p.id === 'crm')!),
  toPromptAction(INTEGRATION_PROMPTS.find((p) => p.id === 'github-pr-review')!),
]

interface SuggestedActionsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedActions({ onSelectPrompt }: SuggestedActionsProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  const { data: credentials = EMPTY_CREDENTIALS } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })
  const { data: services = EMPTY_SERVICES } = useOAuthConnections()

  const [expanded, setExpanded] = useState(true)
  // Collapsible animations are enabled only after the first user toggle, so the
  // initially-open, server-rendered panel appears at full height on first paint
  // instead of replaying the open animation and shifting the input above it.
  const [animationsEnabled, setAnimationsEnabled] = useState(false)
  const [actions, setActions] = useState<Action[]>(INITIAL_ACTIONS)
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

  useEffect(() => {
    if (services.length === 0 || connectedProviders.size === 0) return
    setActions(computeActions(services, connectedProviders))
  }, [connectedProviders, services])

  const handleShuffle = useCallback(() => {
    setActions(computeActions(services, connectedProviders))
  }, [services, connectedProviders])

  const handleSelect = (action: Action) => {
    if (action.kind === 'prompt') {
      onSelectPrompt(action.prompt)
      return
    }
    const match = resolveOAuthServiceForSlug(action.slug)
    if (match) setOAuthTarget(match)
  }

  return (
    <div className='mx-auto mt-7 w-full max-w-[48rem]'>
      <div className='flex items-center justify-between'>
        <button
          type='button'
          onClick={() => {
            setAnimationsEnabled(true)
            setExpanded((prev) => !prev)
          }}
          aria-expanded={expanded}
          className='flex items-center gap-2'
        >
          <span className='text-[var(--text-muted)] text-small'>Suggested actions</span>
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
          aria-label='Shuffle suggested actions'
          aria-hidden={!expanded}
          tabIndex={expanded ? undefined : -1}
          className={cn(
            chipVariants({ variant: 'ghost', flush: true }),
            '-mr-2 gap-1.5 transition-opacity duration-150 ease-out motion-reduce:transition-none',
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        >
          <span className='-mt-px text-[var(--text-muted)] text-small'>Shuffle</span>
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
                  onClick={() => handleSelect(action)}
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
