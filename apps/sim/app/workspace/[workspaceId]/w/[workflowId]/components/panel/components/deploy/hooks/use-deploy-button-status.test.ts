import { describe, expect, it } from 'vitest'
import {
  type DeployButtonStatus,
  resolveDeployButtonStatus,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-button-status'

type Input = Parameters<typeof resolveDeployButtonStatus>[0]

const base: Input = {
  workflowId: 'wf-1',
  isDeploymentInfoResolved: false,
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
      {
        isDeploymentInfoResolved: true,
        isDeployed: true,
        serverNeedsRedeployment: true,
        isAwaitingFirstDeployedState: true,
      },
      // 3. The deployed snapshot lands; the client diff agrees.
      {
        isDeploymentInfoResolved: true,
        isDeployed: true,
        serverNeedsRedeployment: true,
        hasDeployedState: true,
        clientChangeDetected: true,
      },
    ])

    expect(statuses).toEqual(['unknown', 'changed'])
    expect(statuses).not.toContain('live')
  })

  /**
   * `GET /api/workflows/[id]/deploy` returning 500 made `isDeployed` default to
   * false, which rendered a live workflow as "Deploy" beside a version list
   * showing v4 live — an absence of information presented as a fact.
   *
   * The click is also interpreted against the same flag (deployed opens the
   * modal, undeployed deploys), so guessing here decides an action, not just a
   * label. Both reasons say the same thing: do not answer until asked.
   */
  it('does not claim undeployed when deployment info has not answered', () => {
    const status = resolveDeployButtonStatus({
      ...base,
      isDeploymentInfoResolved: false,
      isDeployed: false,
    })

    expect(status).toBe('unknown')
    expect(status).not.toBe('undeployed')
  })
})
