import type { CompareSide } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/components/compare-versions-modal'

export interface ComparePair {
  base: CompareSide
  target: CompareSide
}

/** Compares against the previous saved version, or the draft when no predecessor exists. */
export function resolveComparePair(
  version: number,
  versions: readonly { version: number }[]
): ComparePair {
  let previousVersion: number | null = null
  for (const candidate of versions) {
    if (
      candidate.version < version &&
      (previousVersion === null || candidate.version > previousVersion)
    ) {
      previousVersion = candidate.version
    }
  }

  if (previousVersion === null) {
    return { base: { kind: 'version', version }, target: { kind: 'draft' } }
  }
  return {
    base: { kind: 'version', version: previousVersion },
    target: { kind: 'version', version },
  }
}
