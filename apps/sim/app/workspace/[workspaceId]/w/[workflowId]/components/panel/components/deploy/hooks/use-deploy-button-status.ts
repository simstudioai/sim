/**
 * What the deploy button is allowed to say.
 *
 * `unknown` is a real state, not a placeholder: before the deployed snapshot
 * arrives the client cannot tell `live` from `changed`, and picking either one
 * is a guess that gets corrected a frame later. Naming it lets the button hold
 * still instead.
 */
export type DeployButtonStatus = 'unknown' | 'undeployed' | 'live' | 'changed'

interface ResolveDeployButtonStatusInput {
  workflowId: string | null
  isDeployed: boolean
  /** True only before the FIRST deployed snapshot lands — never on a refetch. */
  isAwaitingFirstDeployedState: boolean
  /** The client's diff, valid only once a deployed snapshot exists. */
  clientChangeDetected: boolean
  hasDeployedState: boolean
  /**
   * The server's verdict on the persisted draft, delivered alongside
   * `isDeployed`. Used only to seed the first paint.
   */
  serverNeedsRedeployment: boolean | undefined
}

/**
 * Resolves the button's status without ever passing through a wrong answer.
 *
 * The bug this replaces: the label read `changeDetected`, which is forced to
 * `false` while the deployed snapshot loads, so a deployed workflow rendered
 * "Live" and then corrected itself to "Update" on every single page load. And
 * because a background refetch also counted as loading, focusing the window
 * pushed an already-correct "Update" back through "Live" and out again.
 *
 * Two rules fix it. A refetch is not a load, so a cached deployed snapshot keeps
 * answering while a fresh one is in flight. And the first paint is seeded from
 * the server's `needsRedeployment` — already fetched for `isDeployed`, and
 * authoritative for the persisted draft — so the common case commits to the
 * right label immediately instead of guessing "Live".
 *
 * The seed only ever decides the first paint. Once a snapshot is cached the
 * client's diff is synchronous over store state, so it answers on the same
 * render and the server's necessarily-staler view stops being consulted — which
 * is what keeps unsaved edits from reading as "Live".
 *
 * `isDeployed` and `needsRedeployment` ride the same response, so a deployed
 * workflow always has a seed available. `unknown` is therefore only reachable
 * before we know the workflow is deployed at all, where "Deploy" is correct.
 */
export function resolveDeployButtonStatus({
  workflowId,
  isDeployed,
  isAwaitingFirstDeployedState,
  clientChangeDetected,
  hasDeployedState,
  serverNeedsRedeployment,
}: ResolveDeployButtonStatusInput): DeployButtonStatus {
  if (!workflowId || !isDeployed) return 'undeployed'

  if (hasDeployedState && !isAwaitingFirstDeployedState) {
    return clientChangeDetected ? 'changed' : 'live'
  }

  if (serverNeedsRedeployment !== undefined) {
    return serverNeedsRedeployment ? 'changed' : 'live'
  }

  return 'unknown'
}
