import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('ChangeDetectionCanary')

interface UseChangeDetectionCanaryProps {
  workflowId: string | null
  /** The client's in-memory answer, from `useChangeDetection`. */
  clientChangeDetected: boolean
  /** The fields the client's answer rests on, for attribution. */
  clientChangedFields: string[]
  /** The server's answer, already fetched by `useDeploymentInfo`. */
  serverNeedsRedeployment: boolean | undefined
  /** True while either operand is still loading — a disagreement means nothing yet. */
  isSettling: boolean
  /** True only when the operation queue is drained and no diff/reconcile is pending. */
  isSettled: boolean
}

/**
 * Reports when the client and the server disagree about whether a workflow needs
 * redeploying.
 *
 * The two answers are computed from the same comparison over operands that are
 * supposed to be equivalent: the server diffs the durable draft against the
 * active deployment version, and the client diffs its merged in-memory state
 * against the same version. Once the operation queue has drained they must
 * agree, so a disagreement is a divergence between the client's state and what
 * was actually persisted — the signature of every phantom "Update" this codebase
 * has shipped.
 *
 * Costs nothing: `useDeploymentInfo` already fetches the server's answer for the
 * `isDeployed` flag, and the client's answer is already computed for the button.
 * Discarding both is why ten instances of this bug class were found by users
 * rather than by us.
 */
export function useChangeDetectionCanary({
  workflowId,
  clientChangeDetected,
  clientChangedFields,
  serverNeedsRedeployment,
  isSettling,
  isSettled,
}: UseChangeDetectionCanaryProps): void {
  /** Reported once per (workflow, verdict pair) so a steady disagreement logs once. */
  const reportedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!workflowId || isSettling || !isSettled || serverNeedsRedeployment === undefined) {
      return
    }

    if (serverNeedsRedeployment === clientChangeDetected) {
      reportedRef.current = null
      return
    }

    const signature = `${workflowId}:${serverNeedsRedeployment}:${clientChangeDetected}`
    if (reportedRef.current === signature) return
    reportedRef.current = signature

    logger.warn('Change detection disagrees with the server', {
      workflowId,
      serverNeedsRedeployment,
      clientChangeDetected,
      /*
       * Only populated when the CLIENT sees changes. The inverse case — the
       * server sees changes the client does not — reports an empty list, and
       * that asymmetry is itself the diagnosis: the client's merged state
       * matches the deployment while the persisted draft does not.
       */
      clientChangedFields,
    })
  }, [
    workflowId,
    clientChangeDetected,
    clientChangedFields,
    serverNeedsRedeployment,
    isSettling,
    isSettled,
  ])
}
