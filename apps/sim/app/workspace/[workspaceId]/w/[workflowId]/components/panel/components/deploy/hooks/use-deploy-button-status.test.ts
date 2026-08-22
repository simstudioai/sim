/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type DeployButtonStatus,
  resolveDeployButtonStatus,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-button-status'

type Input = Parameters<typeof resolveDeployButtonStatus>[0]

const base: Input = {
  workflowId: 'wf-1',
  isDeployed: false,
  isAwaitingFirstDeployedState: false,
  clientChangeDetected: false,
  hasDeployedState: false,
  serverNeedsRedeployment: undefined,
}

/** Replays a render sequence and returns the labels actually committed, deduped. */
function committed(sequence: Array<Partial<Input>>): DeployButtonStatus[] {
  const seen: DeployButtonStatus[] = []
  for (const step of sequence) {
    const status = resolveDeployButtonStatus({ ...base, ...step })
    if (seen[seen.length - 1] !== status) seen.push(status)
  }
  return seen
}

describe('resolveDeployButtonStatus', () => {
  /**
   * The regression this exists for. The old label read `changeDetected`, which
   * is forced false while the deployed snapshot loads, so a changed workflow
   * rendered "Live" on the way to "Update".
   */
  it('never passes through live when loading a workflow that has changes', () => {
    const statuses = committed([
      // 1. Nothing loaded.
      {},
      // 2. deploymentInfo lands — isDeployed and needsRedeployment arrive together.
      { isDeployed: true, serverNeedsRedeployment: true, isAwaitingFirstDeployedState: true },
      // 3. The deployed snapshot lands; the client diff agrees.
      {
        isDeployed: true,
        serverNeedsRedeployment: true,
        hasDeployedState: true,
        clientChangeDetected: true,
      },
    ])

    expect(statuses).toEqual(['undeployed', 'changed'])
    expect(statuses).not.toContain('live')
  })

  it('settles straight to live for a deployed workflow with no changes', () => {
    const statuses = committed([
      {},
      { isDeployed: true, serverNeedsRedeployment: false, isAwaitingFirstDeployedState: true },
      { isDeployed: true, serverNeedsRedeployment: false, hasDeployedState: true },
    ])

    expect(statuses).toEqual(['undeployed', 'live'])
    expect(statuses).not.toContain('changed')
  })

  /**
   * `refetchOnWindowFocus` is on for both queries, so this fires on every focus.
   * A refetch keeps the cached snapshot, so the answer must not move.
   */
  it('holds its answer across a background refetch', () => {
    const settled: Partial<Input> = {
      isDeployed: true,
      serverNeedsRedeployment: true,
      hasDeployedState: true,
      clientChangeDetected: true,
    }

    const statuses = committed([
      settled,
      // Refetching: data is still cached, so `isAwaitingFirstDeployedState` stays false.
      settled,
      settled,
    ])

    expect(statuses).toEqual(['changed'])
  })

  it('prefers the client diff over the server seed once a snapshot exists', () => {
    // Unsaved edits: the server still describes the persisted draft.
    const status = resolveDeployButtonStatus({
      ...base,
      isDeployed: true,
      serverNeedsRedeployment: false,
      hasDeployedState: true,
      clientChangeDetected: true,
    })

    expect(status).toBe('changed')
  })

  it('reports undeployed without a workflow', () => {
    expect(resolveDeployButtonStatus({ ...base, workflowId: null })).toBe('undeployed')
  })

  it('falls back to unknown only when deployed with no verdict from either side', () => {
    const status = resolveDeployButtonStatus({
      ...base,
      isDeployed: true,
      isAwaitingFirstDeployedState: true,
      serverNeedsRedeployment: undefined,
    })

    expect(status).toBe('unknown')
  })
})
