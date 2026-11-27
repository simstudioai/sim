import { describe, expect, it } from 'vitest'
import { liveAgainstDraft, withDeploymentLive } from './deployment-live'

const ID = '00000000-0000-4000-8000-00000000000a'

const active = (version: number) => ({
  deploymentVersionId: `dv-${version}`,
  version,
  deployedAt: '2026-11-20T00:00:00Z',
})

const attempt = (version: number, status: string, error?: string, isCurrent = true) => ({
  id: `op-${version}`,
  deploymentVersionId: `dv-${version}`,
  version,
  action: 'deploy',
  status,
  isCurrent,
  readiness: { webhooks: 'ready', schedules: 'ready', mcp: 'ready' },
  requestedAt: '2026-11-20T00:00:00Z',
  ...(error ? { error: { code: 'E', message: error, retryable: false } } : {}),
})

const STATUS = `sim workflows deployment status ${ID}  # shows when version 7 is live`

/** A `next` written as the command, then why after `  # `, as the object the result carries. */
function step(text: string | undefined) {
  if (text === undefined) return undefined
  const [command, reason] = text.split('  # ')
  return { command, reason }
}

describe('withDeploymentLive after a deploy', () => {
  it.each([
    {
      name: 'the deployed version serves',
      response: {
        version: 7,
        activeDeployment: active(7),
        latestDeploymentAttempt: attempt(7, 'active'),
      },
      live: 'version 7, serving (this deploy)',
      // Nothing follows a serving deploy: running it would send real writes.
      next: undefined,
    },
    {
      name: 'the older version still serves while the new one activates',
      response: {
        version: 7,
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(7, 'activating'),
      },
      live: 'version 6 still serving; version 7 activating',
      next: STATUS,
    },
    {
      name: 'the first version is still preparing',
      response: {
        version: 1,
        activeDeployment: null,
        latestDeploymentAttempt: attempt(1, 'preparing'),
      },
      live: 'not deployed; version 1 activating',
      next: `sim workflows deployment status ${ID}  # shows when version 1 is live`,
    },
    {
      name: 'the new version failed',
      response: {
        version: 7,
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(7, 'failed', 'webhook registration failed'),
      },
      live: 'version 6 still serving; version 7 failed: webhook registration failed',
      next: `sim workflows deploy ${ID}  # deploys again once the cause is fixed`,
    },
    {
      name: 'a later deploy overtook this one and is activating',
      response: {
        version: 7,
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(8, 'activating'),
      },
      live: 'version 6 serving; version 7 replaced by version 8 (activating)',
      next: undefined,
    },
    {
      name: 'a later deploy overtook this one and is already live',
      response: {
        version: 7,
        activeDeployment: active(8),
        latestDeploymentAttempt: attempt(8, 'active'),
      },
      live: 'version 8 serving; version 7 replaced by version 8 (active)',
      next: undefined,
    },
    {
      name: 'this attempt is no longer the current one',
      response: {
        version: 7,
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(7, 'activating', undefined, false),
      },
      live: 'version 6 serving; version 7 replaced by a later deployment',
      next: undefined,
    },
    {
      name: 'this attempt was superseded',
      response: {
        version: 7,
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(7, 'superseded'),
      },
      live: 'version 6 serving; version 7 replaced by a later deployment',
      next: undefined,
    },
  ])('$name', ({ response, live, next }) => {
    const payload = { id: ID, isDeployed: true, warnings: [], ...response }
    const shown = withDeploymentLive('deployWorkflow', payload) as Record<string, unknown>
    expect(
      Object.keys(shown)
        .filter((key) => key !== 'next')
        .at(-1)
    ).toBe('live')
    expect(shown.live).toBe(live)
    expect(shown.next).toEqual(step(next))
  })

  it('names a rollback and an activation as what made the version live', () => {
    const payload = {
      id: ID,
      isDeployed: true,
      version: 5,
      activeDeployment: active(5),
      latestDeploymentAttempt: attempt(5, 'active'),
    }
    expect(withDeploymentLive('rollbackWorkflow', payload)).toMatchObject({
      live: 'version 5, serving (this rollback)',
    })
    expect(withDeploymentLive('activateWorkflowVersion', payload)).toMatchObject({
      live: 'version 5, serving (this activation)',
    })
    expect(withDeploymentLive('rollbackWorkflow', payload)).not.toHaveProperty('next')
    // Only a deploy names itself as the retry of a failure.
    const failed = {
      ...payload,
      activeDeployment: active(6),
      latestDeploymentAttempt: attempt(5, 'failed', 'x'),
    }
    expect(withDeploymentLive('rollbackWorkflow', failed)).not.toHaveProperty('next')
  })
})

describe('withDeploymentLive on a deployment status', () => {
  it.each([
    {
      name: 'nothing is deployed, though needsRedeployment is false',
      response: { activeDeployment: null, latestDeploymentAttempt: null, needsRedeployment: false },
      live: 'not deployed',
      next: undefined,
    },
    {
      name: 'the live version is the draft',
      response: {
        activeDeployment: active(7),
        latestDeploymentAttempt: attempt(7, 'active'),
        needsRedeployment: false,
      },
      live: 'version 7, matches the draft',
      next: undefined,
    },
    {
      name: 'the draft has changed since',
      response: {
        activeDeployment: active(7),
        latestDeploymentAttempt: attempt(7, 'active'),
        needsRedeployment: true,
      },
      live: 'version 7, draft has undeployed changes',
      next: `sim workflows deploy ${ID}  # makes the draft live`,
    },
    {
      name: 'a newer version is activating, which needsRedeployment reports as false',
      response: {
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(7, 'activating'),
        needsRedeployment: false,
      },
      live: 'version 6 still serving; version 7 activating',
      next: STATUS,
    },
    {
      name: 'the latest attempt failed',
      response: {
        activeDeployment: active(6),
        latestDeploymentAttempt: attempt(7, 'failed', 'schedule invalid'),
        needsRedeployment: true,
      },
      live: 'version 6, draft has undeployed changes; version 7 failed: schedule invalid',
      next: `sim workflows deploy ${ID}  # makes the draft live`,
    },
  ])('$name', ({ response, live, next }) => {
    const payload = { id: ID, isDeployed: response.activeDeployment !== null, ...response }
    const shown = withDeploymentLive('getWorkflowDeployment', payload) as Record<string, unknown>
    expect(shown.live).toBe(live)
    expect(shown.next).toEqual(step(next))
  })

  it('leaves any other operation as it was', () => {
    const payload = { id: ID, activeDeployment: null, latestDeploymentAttempt: null }
    expect(withDeploymentLive('undeployWorkflow', payload)).toBe(payload)
  })
})

describe('liveAgainstDraft', () => {
  it.each([
    [null, false, 'not deployed'],
    [3, false, 'version 3, matches the draft'],
    [3, true, 'version 3, draft has undeployed changes'],
    // A server older than `deployedVersion` leaves the version unknown.
    [undefined, true, 'draft has undeployed changes'],
    [undefined, false, undefined],
  ])('live at %s, draft differs %s: %s', (deployedVersion, needsRedeployment, live) => {
    expect(liveAgainstDraft(deployedVersion, needsRedeployment)).toBe(live)
  })
})
