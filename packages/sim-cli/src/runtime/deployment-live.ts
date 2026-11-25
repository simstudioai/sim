import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type { GetWorkflowDeploymentResponse, V2OperationName } from '../generated/v2-api'
import { shellArgument } from './run-next'

type DeploymentState = Pick<
  GetWorkflowDeploymentResponse['data'],
  'activeDeployment' | 'latestDeploymentAttempt'
>
type DeploymentAttempt = NonNullable<DeploymentState['latestDeploymentAttempt']>

/** What is live, in one line, and the command that follows from it, with why. */
export interface LiveDeployment {
  live: string
  next?: { command: string; reason: string }
}

/** Operations that switch which version is live, and how `live` names the switch. */
const ACTIVATIONS: Readonly<Partial<Record<V2OperationName, string>>> = {
  deployWorkflow: 'this deploy',
  rollbackWorkflow: 'this rollback',
  activateWorkflowVersion: 'this activation',
}

const PENDING: ReadonlySet<DeploymentAttempt['status']> = new Set(['preparing', 'activating'])

/** The latest deployment attempt, unless a later one has replaced it. */
function currentAttempt(state: DeploymentState): DeploymentAttempt | null {
  const attempt = state.latestDeploymentAttempt
  return attempt && attempt.isCurrent !== false ? attempt : null
}

/** What serves now, as the clause before what became of another version. */
function serving(state: DeploymentState, still: boolean): string {
  const active = state.activeDeployment
  if (!active) return 'not deployed'
  return `version ${active.version} ${still ? 'still serving' : 'serving'}`
}

/** Why `version` failed, as the deployment attempt reported it. */
function failure(version: number, attempt: DeploymentAttempt): string {
  return `version ${version} failed: ${attempt.error?.message ?? 'no reason was given'}`
}

/** The status read that shows when `version` is live. */
function whenLive(workflowId: string, version: number): NonNullable<LiveDeployment['next']> {
  return {
    command: `sim workflows deployment status ${shellArgument(workflowId)}`,
    reason: `shows when version ${version} is live`,
  }
}

/**
 * What is live after a deploy, rollback or activation of `version`, read only from the response:
 * the version that call made live; the one still serving while it activates or after it failed
 * (`retry`, when given, is the command that tries again); or, when a later attempt overtook it,
 * that attempt. The top-level `version` names the version the call admitted, not the live one, and
 * `isDeployed` is true while any version is live, so neither alone says the call took effect.
 */
export function liveAfterActivation(
  state: DeploymentState,
  workflowId: string,
  version: number | undefined,
  subject: string,
  retry?: string
): LiveDeployment {
  const attempt = state.latestDeploymentAttempt
  const target = version ?? attempt?.version
  if (target === undefined) return { live: serving(state, false) }
  if (state.activeDeployment?.version === target) {
    return {
      live: `version ${target}, serving (${subject})`,
      next: {
        command: `sim workflows run ${shellArgument(workflowId)}`,
        reason: `runs version ${target}, the live deployment; add --input '<json>' for its input, or --manual to run the draft`,
      },
    }
  }
  if (!attempt) {
    // No attempt reported: whether the version is on its way is unknown, and the status read says.
    return {
      live: `${serving(state, true)}; version ${target} not live yet`,
      next: whenLive(workflowId, target),
    }
  }
  if (attempt.version !== target) {
    return {
      live: `${serving(state, false)}; version ${target} replaced by version ${attempt.version} (${attempt.status})`,
    }
  }
  if (attempt.isCurrent === false || attempt.status === 'superseded') {
    return { live: `${serving(state, false)}; version ${target} replaced by a later deployment` }
  }
  if (PENDING.has(attempt.status)) {
    return {
      live: `${serving(state, true)}; version ${target} activating`,
      next: whenLive(workflowId, target),
    }
  }
  if (attempt.status === 'failed') {
    return {
      live: `${serving(state, true)}; ${failure(target, attempt)}`,
      ...(retry
        ? { next: { command: retry, reason: 'deploys again once the cause is fixed' } }
        : {}),
    }
  }
  return { live: `${serving(state, false)}; version ${target} no longer live` }
}

/** A live version against the draft. */
function versionAgainstDraft(version: number, needsRedeployment: boolean): string {
  return needsRedeployment
    ? `version ${version}, draft has undeployed changes`
    : `version ${version}, matches the draft`
}

/**
 * The live version against the draft: `not deployed`, or the version and whether the draft
 * matches it. `needsRedeployment` is false when nothing is deployed, so it is read only beside a
 * version. A server that reports no `deployedVersion` (one older than the field) leaves the version
 * unknown: only a draft known to differ is said, and otherwise nothing.
 */
export function liveAgainstDraft(
  deployedVersion: number | null | undefined,
  needsRedeployment: boolean
): string | undefined {
  if (deployedVersion === null) return 'not deployed'
  if (typeof deployedVersion === 'number') {
    return versionAgainstDraft(deployedVersion, needsRedeployment)
  }
  return needsRedeployment ? 'draft has undeployed changes' : undefined
}

/**
 * What a deployment status says is live: the active version and whether the draft matches it, or
 * the version still serving while a newer one activates or after it failed. `needsRedeployment`
 * is false both when nothing is deployed and while an attempt activates, so neither reads as a
 * draft matching what is live.
 */
export function liveDeploymentStatus(
  state: DeploymentState & { needsRedeployment: boolean },
  workflowId: string
): LiveDeployment {
  const active = state.activeDeployment
  const attempt = currentAttempt(state)
  if (attempt && PENDING.has(attempt.status) && attempt.version !== active?.version) {
    return {
      live: `${serving(state, true)}; version ${attempt.version} activating`,
      next: whenLive(workflowId, attempt.version),
    }
  }
  const failed =
    attempt?.status === 'failed' && attempt.version !== active?.version
      ? `; ${failure(attempt.version, attempt)}`
      : ''
  const live = `${active ? versionAgainstDraft(active.version, state.needsRedeployment) : 'not deployed'}${failed}`
  if (!active || !state.needsRedeployment) return { live }
  return {
    live,
    next: {
      command: `sim workflows deploy ${shellArgument(workflowId)}`,
      reason: 'makes the draft live',
    },
  }
}

/** Whether the draft is what serves: a version is live, none is activating, and the draft matches it. */
export function draftIsLive(state: DeploymentState & { needsRedeployment: boolean }): boolean {
  const attempt = currentAttempt(state)
  return (
    state.activeDeployment !== null &&
    !(attempt && PENDING.has(attempt.status)) &&
    !state.needsRedeployment
  )
}

/** A payload's deployment state, when it has the fields a deployment response always carries. */
function deploymentState(payload: Record<string, unknown>): DeploymentState | null {
  if (!('activeDeployment' in payload) || !('latestDeploymentAttempt' in payload)) return null
  return {
    activeDeployment: toRecordOrNull(
      payload.activeDeployment
    ) as DeploymentState['activeDeployment'],
    latestDeploymentAttempt: toRecordOrNull(
      payload.latestDeploymentAttempt
    ) as DeploymentState['latestDeploymentAttempt'],
  }
}

/**
 * A deployment response with `live` first (the first line a person reads) and, when one follows,
 * `next` last: for a deploy, rollback or activation, {@link liveAfterActivation}; for the status
 * read, {@link liveDeploymentStatus}. Any other payload comes back as it was.
 */
export function withDeploymentLive(operation: V2OperationName, payload: unknown): unknown {
  if (!isRecordLike(payload) || typeof payload.id !== 'string') return payload
  const subject = ACTIVATIONS[operation]
  if (subject === undefined && operation !== 'getWorkflowDeployment') return payload
  const state = deploymentState(payload)
  if (!state) return payload
  const { live, next } =
    subject === undefined
      ? liveDeploymentStatus(
          { ...state, needsRedeployment: payload.needsRedeployment === true },
          payload.id
        )
      : liveAfterActivation(
          state,
          payload.id,
          typeof payload.version === 'number' ? payload.version : undefined,
          subject,
          operation === 'deployWorkflow'
            ? `sim workflows deploy ${shellArgument(payload.id)}`
            : undefined
        )
  // The command, then why as a shell comment: pasted whole, the comment is ignored.
  return { live, ...payload, ...(next ? { next: `${next.command}  # ${next.reason}` } : {}) }
}
