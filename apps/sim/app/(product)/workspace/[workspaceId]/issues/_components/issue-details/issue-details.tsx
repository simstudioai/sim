'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { type PropertyItem, PropertyList } from '@sim/emcn/property-list'
import { ExecutionSteps } from '@sim/emcn-platform/execution-steps'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import { DashboardTable } from '@/app/(product)/workspace/[workspaceId]/_components/dashboard-table/dashboard-table'
import {
  DetailSection,
  DetailSplit,
} from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { WorkspaceChanges } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-changes/workspace-changes'
import type {
  IssueDetail,
  WorkspaceRead,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import { useViewerTimeZone } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { DocumentChange } from '@/app/(product)/workspace/[workspaceId]/issues/_components/document-change/document-change'
import { IssueComparison } from '@/app/(product)/workspace/[workspaceId]/issues/_components/issue-comparison/issue-comparison'
import styles from '@/app/(product)/workspace/[workspaceId]/issues/_components/issue-details/issue-details.module.css'
import { ISSUE_STATE_LABEL } from '@/app/(product)/workspace/[workspaceId]/issues/_components/issue-list/issue-state'
import { SourceExcerpt } from '@/app/(product)/workspace/[workspaceId]/issues/_components/source-excerpt/source-excerpt'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatTimestamp } from '@/platform/shared/time'

export type IssueDecision = 'approve' | 'deny' | 'cancel' | 'retry' | 'reload'

interface IssueActions {
  /** Settles when the decision is recorded; the control bar holds repeat submissions until then. */
  decide: (decision: IssueDecision) => Promise<void>
}

interface IssueDetailsProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  issue: IssueDetail
  actions: IssueActions
  back: { href: string; label: string }
}

const CONFIRM = {
  deny: {
    title: 'Deny this issue?',
    description: 'The proposal closes without changes. Its evidence stays in the issue.',
    confirmLabel: 'Deny',
    pendingLabel: 'Denying…',
  },
  cancel: {
    title: 'Cancel this issue?',
    description: 'Work stops and nothing more is applied. Its history stays in the issue.',
    confirmLabel: 'Cancel issue',
    pendingLabel: 'Cancelling…',
  },
} as const

/**
 * One issue, read-only: the proposal, its expected impact and its evidence beside the facts.
 * Decisions live only in the control bar, chosen by the issue's state.
 */
export function IssueDetails({ issue, actions, back, read }: IssueDetailsProps) {
  const search = useSearchParams()
  const scope = useSurfaceScope()
  const timeZone = useViewerTimeZone()
  const [pending, setPending] = useState<IssueDecision | null>(null)
  const [confirming, setConfirming] = useState<'deny' | 'cancel' | null>(null)
  /** The last confirmation asked, so its labels hold while the dialog closes. */
  const [confirmed, setConfirmed] = useState<'deny' | 'cancel'>('deny')
  const href = (path: string) => platformHref(path, search)

  async function decide(decision: IssueDecision) {
    if (pending) return
    setPending(decision)
    try {
      await actions.decide(decision)
    } finally {
      setPending(null)
    }
  }

  const busy = pending !== null
  const decision = (label: string, kind: IssueDecision) => (
    <Button
      key={kind}
      variant='secondary'
      size='compact'
      disabled={busy}
      onClick={() => void decide(kind)}
    >
      {label}
    </Button>
  )
  const confirmable = (kind: 'deny' | 'cancel', label: string) => (
    <Button
      key={kind}
      variant='quiet'
      size='compact'
      destructive
      disabled={busy}
      onClick={() => {
        setConfirmed(kind)
        setConfirming(kind)
      }}
    >
      {label}
    </Button>
  )
  const buttons = {
    'needs-review': [confirmable('deny', 'Deny'), decision('Approve', 'approve')],
    queued: [confirmable('cancel', 'Cancel')],
    'in-progress': [confirmable('cancel', 'Cancel')],
    blocked: [
      confirmable('cancel', 'Cancel'),
      issue.blockedBy && (
        <Button
          key='reconnect'
          variant='secondary'
          size='compact'
          disabled={busy}
          render={
            <Link
              href={href(
                surfaceHref(
                  scope,
                  `/integrations/${encodeURIComponent(issue.blockedBy.providerId)}`
                )
              )}
            />
          }
        >
          Reconnect integration
        </Button>
      ),
    ],
    failed: [confirmable('cancel', 'Cancel'), decision('Retry', 'retry')],
    merged: [
      issue.changelogEntryId && (
        <Button
          key='changelog'
          variant='secondary'
          size='compact'
          render={
            <Link
              href={href(
                workspacePath(
                  issue.workspace.id,
                  `changelog/${encodeURIComponent(issue.changelogEntryId)}`
                )
              )}
            />
          }
        >
          See in changelog
        </Button>
      ),
    ],
    stale: [decision('Reload', 'reload')],
    denied: [],
    cancelled: [],
  }[issue.state].filter(Boolean)

  const facts: PropertyItem[] = [
    { id: 'status', label: 'Status', kind: 'text', value: ISSUE_STATE_LABEL[issue.state] },
    { id: 'id', label: 'ID', kind: 'text', value: issue.id },
    {
      id: 'created',
      label: 'Created',
      kind: 'text',
      value: formatTimestamp(issue.createdAt, timeZone),
    },
    {
      id: 'workspace',
      label: 'Workspace',
      kind: 'link',
      value: issue.workspace.name,
      href: href(workspacePath(issue.workspace.id, 'dashboards')),
    },
    ...issue.outcomes.map((outcome): PropertyItem => {
      switch (outcome.kind) {
        case 'time':
          return {
            id: outcome.id,
            label: outcome.label,
            kind: 'text',
            value: formatTimestamp(outcome.at, timeZone),
          }
        case 'person':
          return {
            id: outcome.id,
            label: outcome.label,
            kind: 'person',
            value: outcome.person.name,
            src: outcome.person.src,
          }
        case 'link':
          return {
            id: outcome.id,
            label: outcome.label,
            kind: 'link',
            value: outcome.value,
            href: href(outcome.href),
          }
        default:
          return { id: outcome.id, label: outcome.label, kind: 'text', value: outcome.value }
      }
    }),
  ]

  return (
    <>
      <DetailSplit
        read={read}
        back={back}
        label={`${issue.id} details`}
        actions={buttons}
        railLabel='Facts'
        rail={<PropertyList title='Facts' titleHidden properties={facts} />}
      >
        <DirectoryHeading title={issue.title} description={issue.description} />
        {issue.document && (
          <DocumentChange change={issue.document} applied={issue.state === 'merged'} />
        )}
        <WorkspaceChanges changes={issue.workspaceChanges} />
        {issue.comparison && (
          <DetailSection title={issue.comparison.title}>
            <IssueComparison columns={issue.comparison.columns} />
          </DetailSection>
        )}
        {issue.impact.length > 0 && (
          <DetailSection title='Expected impact'>
            <div className={styles.prose}>
              {issue.impact.map((paragraph) => (
                <p key={paragraph} data-type='T048'>
                  {paragraph}
                </p>
              ))}
            </div>
          </DetailSection>
        )}
        {issue.excerpt && (
          <DetailSection title={issue.excerpt.title}>
            <SourceExcerpt
              provider={issue.excerpt.provider}
              source={issue.excerpt.source}
              quote={issue.excerpt.quote}
            />
          </DetailSection>
        )}
        {issue.evidence && (
          <DetailSection title={issue.evidence.title}>
            <DashboardTable
              label={issue.evidence.title}
              columns={issue.evidence.columns}
              rows={issue.evidence.rows}
            />
          </DetailSection>
        )}
        {issue.steps && <ExecutionSteps title={issue.steps.title} steps={issue.steps.steps} />}
      </DetailSplit>
      <ConfirmDialog
        target={confirming}
        onClose={() => setConfirming(null)}
        title={(kind) => CONFIRM[kind].title}
        description={(kind) => CONFIRM[kind].description}
        confirmLabel={CONFIRM[confirmed].confirmLabel}
        pendingLabel={CONFIRM[confirmed].pendingLabel}
        onConfirm={(kind) => decide(kind)}
      />
    </>
  )
}
