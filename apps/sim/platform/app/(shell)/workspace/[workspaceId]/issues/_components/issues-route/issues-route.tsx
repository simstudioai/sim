'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type {
  IssueDetail,
  IssueOutcome,
  IssueState,
  IssuesData,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useIssueDecisions } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import {
  type IssueDecision,
  IssueDetails,
} from '@/platform/app/(shell)/workspace/[workspaceId]/issues/_components/issue-details/issue-details'
import { IssueList } from '@/platform/app/(shell)/workspace/[workspaceId]/issues/_components/issue-list/issue-list'

const NEXT_STATE: Record<IssueDecision, IssueState> = {
  approve: 'queued',
  deny: 'denied',
  cancel: 'cancelled',
  retry: 'in-progress',
  reload: 'needs-review',
}

/** The example viewer who makes this session's decisions. */
const VIEWER = { id: 'emir', name: 'Emir Karabeg' }

function decidedOutcomes(state: IssueState, at: number): IssueOutcome[] {
  switch (state) {
    case 'queued':
      return [
        { id: 'approved-by', label: 'Approved by', kind: 'person', person: VIEWER },
        { id: 'approved', label: 'Approved', kind: 'time', at },
      ]
    case 'denied':
      return [
        { id: 'denied-by', label: 'Denied by', kind: 'person', person: VIEWER },
        { id: 'denied', label: 'Denied', kind: 'time', at },
      ]
    case 'cancelled':
      return [
        { id: 'cancelled-by', label: 'Cancelled by', kind: 'person', person: VIEWER },
        { id: 'cancelled', label: 'Cancelled', kind: 'time', at },
      ]
    case 'in-progress':
      return [{ id: 'retried', label: 'Retried', kind: 'time', at }]
    default:
      return []
  }
}

interface IssuesRouteProps {
  data: IssuesData
}

/** The example list, with this session's decisions applied to each issue's state. */
export function IssuesRoute({ data }: IssuesRouteProps) {
  const { decisions } = useIssueDecisions()
  return (
    <NuqsAdapter>
      <IssueList
        data={{
          ...data,
          issues: data.issues.map((issue) =>
            decisions[issue.id] ? { ...issue, state: decisions[issue.id] } : issue
          ),
        }}
      />
    </NuqsAdapter>
  )
}

interface IssueRouteProps {
  issue: IssueDetail
  back: { href: string; label: string }
}

/** Example decisions change only this browser session: nothing is sent or stored. */
export function IssueRoute({ issue, back }: IssueRouteProps) {
  const { decisions, decide } = useIssueDecisions()
  const decided = decisions[issue.id]
  return (
    <IssueDetails
      issue={
        decided
          ? { ...issue, state: decided, outcomes: decidedOutcomes(decided, issue.referenceTime) }
          : issue
      }
      back={back}
      actions={{
        decide: async (decision) => decide(issue.id, NEXT_STATE[decision]),
      }}
    />
  )
}
