import type { CompareSide } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components/compare-versions-modal'

export interface ComparePair {
  base: CompareSide
  target: CompareSide
}

/**
 * Which two sides a "Compare" on a version opens: the older version on the
 * left and the newer on the right, except that the live version (or any
 * version when nothing is live) compares against the draft, since that is
 * what a redeploy would ship.
 */
export function resolveComparePair(version: number, activeVersion: number | null): ComparePair {
  if (activeVersion === null || activeVersion === version) {
    return { base: { kind: 'version', version }, target: { kind: 'draft' } }
  }
  const [low, high] = version < activeVersion ? [version, activeVersion] : [activeVersion, version]
  return { base: { kind: 'version', version: low }, target: { kind: 'version', version: high } }
}
