'use client'

import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ArrowUpRight } from '@sim/emcn/icons'
import { GithubIcon, JiraIcon, LinearIcon } from '@/components/icons'
import {
  issueByKey,
  type LinkedTicket,
  linkedTickets,
  ticketUrl,
} from '@/app/playground/org/lib/mock-data'

const SYSTEM_ICON = { linear: LinearIcon, jira: JiraIcon, github: GithubIcon } as const
const SYSTEM_LABEL = { linear: 'Linear', jira: 'Jira', github: 'GitHub' } as const

export function TicketIcon({ ticket, className }: { ticket: LinkedTicket; className?: string }) {
  const Icon = SYSTEM_ICON[ticket.system]
  return <Icon className={cn('size-[12px] shrink-0', className)} />
}

/** Compact marker next to a Sim issue key: one tracker ticket links straight out, several open a list. */
export function LinkedTickets({ issueKey }: { issueKey: string }) {
  const issue = issueByKey(issueKey)
  if (!issue) throw new Error(`Unknown issue ${issueKey}`)
  const tickets = linkedTickets(issue)
  if (!tickets.length) return null
  const chrome =
    'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] px-1 text-[var(--text-muted)] text-caption opacity-70 transition-opacity hover:bg-[var(--surface-hover)] hover:opacity-100'
  if (tickets.length === 1) {
    const [ticket] = tickets
    return (
      <a
        href={ticketUrl(ticket)}
        target='_blank'
        rel='noopener noreferrer'
        title={`${ticket.key} in ${SYSTEM_LABEL[ticket.system]}`}
        className={chrome}
      >
        <TicketIcon ticket={ticket} />
      </a>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type='button' className={chrome} aria-label={`${tickets.length} linked tickets`}>
          <TicketIcon ticket={tickets[0]} />
          {tickets.length}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[320px]'>
        {tickets.map((ticket) => (
          <DropdownMenuItem key={ticket.key} asChild>
            <a href={ticketUrl(ticket)} target='_blank' rel='noopener noreferrer'>
              <TicketIcon ticket={ticket} />
              <span className='shrink-0 text-[var(--text-muted)]'>{ticket.key}</span>
              <span className='min-w-0 flex-1 truncate'>{ticket.title}</span>
              <ArrowUpRight />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
