'use client'

import { Button } from '@sim/emcn/button'
import { useRouter } from 'next/navigation'
import { ShellGate } from '@/platform/app/_components/shell-gate/shell-gate'
import type { WorkspaceEntryDecision } from '@/platform/lib/data/workspace-entry'
import { useFirstWorkspace } from '@/platform/lib/data/workspaces'

type CreationPolicy = Extract<WorkspaceEntryDecision, { kind: 'blocked' }>['policy']

/** Why a viewer with no workspace cannot create one, in the legacy entry's words. */
function blockedDescription(policy: CreationPolicy) {
  if (policy.blockedReasonCode === 'organization-subscription-inactive')
    return "Your organization's subscription is inactive, so new workspaces can't be created. Ask an organization owner to reactivate it."
  if (policy.blockedReasonCode === 'permission-group-denied')
    return "Your permission group doesn't allow creating workspaces, and you don't have access to an existing one. Ask an organization admin for workspace access."
  if (policy.workspaceMode === 'organization')
    return "Your account is linked to an organization, but you don't have access to any of its workspaces. Ask an organization admin for workspace access, then check again — or sign out and back in if you recently left the organization."
  return 'Your plan has reached its workspace limit and none of your workspaces are active. Upgrade your plan to create another workspace, or contact support to restore an archived one.'
}

function FirstWorkspace() {
  const { failed, retry } = useFirstWorkspace()
  if (!failed) return null
  return (
    <ShellGate
      title='Could not create your workspace'
      description='Something went wrong while setting up your first workspace. Please try again.'
    >
      <Button variant='primary' onClick={retry}>
        Try again
      </Button>
    </ShellGate>
  )
}

/** The workspace entry for a viewer it could not send straight to a workspace. */
export function WorkspaceEntry({
  decision,
}: {
  decision: Exclude<WorkspaceEntryDecision, { kind: 'redirect' }>
}) {
  const router = useRouter()
  if (decision.kind === 'create') return <FirstWorkspace />
  if (decision.kind === 'blocked')
    return (
      <ShellGate title='No workspace access yet' description={blockedDescription(decision.policy)}>
        <Button variant='primary' onClick={() => router.refresh()}>
          Check again
        </Button>
      </ShellGate>
    )
  return (
    <ShellGate
      title='Could not load your workspaces'
      description='Something went wrong while loading your workspaces. Please try again.'
    >
      <Button variant='primary' onClick={() => router.refresh()}>
        Try again
      </Button>
    </ShellGate>
  )
}
