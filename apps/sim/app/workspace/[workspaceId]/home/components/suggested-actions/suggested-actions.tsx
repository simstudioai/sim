'use client'

import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowRight, ChevronDown, Expandable, ExpandableContent } from '@/components/emcn'
import { Table } from '@/components/emcn/icons'
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
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useOAuthConnections } from '@/hooks/queries/oauth/oauth-connections'

type Icon = ComponentType<{ className?: string }>

type Action =
  | { kind: 'prompt'; id: string; label: string; prompt: string; icon: Icon }
  | { kind: 'integration'; id: string; label: string; icon: Icon }

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

const EMPTY_CREDENTIALS: ReturnType<typeof useWorkspaceCredentials>['data'] = []
const EMPTY_SERVICES: ReturnType<typeof useOAuthConnections>['data'] = []

/** Returns up to `n` random items from the array (Fisher–Yates). */
function sample<T>(arr: readonly T[], n: number): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, n)
}

interface SuggestedActionsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedActions({ onSelectPrompt }: SuggestedActionsProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const [expanded, setExpanded] = useState(true)

  const { data: credentials = EMPTY_CREDENTIALS } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })
  const { data: services = EMPTY_SERVICES } = useOAuthConnections()

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

  const [actions, setActions] = useState<Action[]>([])

  useEffect(() => {
    const toIntegrationAction = (s: (typeof services)[number]): Action => ({
      kind: 'integration',
      id: `integrate-${s.providerId}`,
      label: `Integrate with ${s.name}`,
      icon: s.icon,
    })

    const availableServices = services.filter((s) => !connectedProviders.has(s.providerId))
    const integrations: Action[] =
      connectedProviders.size === 0
        ? ['slack', 'google-email']
            .map((id) => availableServices.find((s) => s.providerId === id))
            .filter((s): s is (typeof services)[number] => Boolean(s))
            .map(toIntegrationAction)
        : sample(availableServices, 2).map(toIntegrationAction)

    const toPromptAction = (option: PromptOption): Action => ({
      kind: 'prompt',
      id: option.id,
      label: option.label,
      prompt: option.prompt,
      icon: option.icon,
    })

    const [tablePick] = sample(TABLE_PROMPTS, 1)
    const integrationPool = INTEGRATION_PROMPTS.filter(
      (p) => !p.providerId || !connectedProviders.has(p.providerId)
    )
    const [integrationPick] = sample(
      integrationPool.length > 0 ? integrationPool : INTEGRATION_PROMPTS,
      1
    )

    setActions([...integrations, toPromptAction(tablePick), toPromptAction(integrationPick)])
  }, [connectedProviders, services])

  if (actions.length === 0) return null

  const handleSelect = (action: Action) => {
    if (action.kind === 'prompt') {
      onSelectPrompt(action.prompt)
      return
    }
    router.push(`/workspace/${workspaceId}/integrations`)
  }

  return (
    <div className='mx-auto mt-6 w-full max-w-[44rem]'>
      <button
        type='button'
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className='flex items-center gap-2'
      >
        <span className='font-base text-[var(--text-muted)] text-small'>Suggested actions</span>
        <ChevronDown
          className={cn(
            'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
            !expanded && '-rotate-90'
          )}
        />
      </button>
      <Expandable expanded={expanded}>
        <ExpandableContent className='mt-2'>
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
                  <Icon className='h-[16px] w-[16px] flex-shrink-0 text-[var(--text-icon)]' />
                  <span className='flex-1 truncate font-base text-[var(--text-body)] text-sm'>
                    {action.label}
                  </span>
                  <ArrowRight className='h-[16px] w-[16px] shrink-0 text-[var(--text-icon)]' />
                </button>
              )
            })}
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
