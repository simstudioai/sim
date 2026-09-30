import { WORKSPACES } from '@/app/playground/org/fixtures/mock-data'
import type { Project } from '@/app/playground/org/lib/project'
import type { Workspace } from '@/app/playground/org/lib/types'

/** What a real workspace shows when no pack claims it: real resources, nothing mock on top. */
export const NO_PACK: Workspace = {
  id: 'none',
  name: '',
  description: '',
  tracker: { kind: 'sim', label: 'Sim tracker' },
  feedbackSources: [],
  dashboards: [],
  needsYou: 0,
}

/**
 * Picks the overlay pack for a real workspace: first the pack whose `matchWorkflows` names one
 * of the workspace's workflows, then the pack whose `match` hits the workspace name. A workspace
 * nothing claims shows only its real resources.
 */
export function matchOverlay(
  name: string,
  workflowNames: readonly string[]
): Pick<Project, 'mock' | 'overlayMatched'> {
  const byWorkflow = WORKSPACES.find((pack) =>
    pack.matchWorkflows?.some((wanted) => workflowNames.includes(wanted))
  )
  const matched = byWorkflow ?? WORKSPACES.find((pack) => pack.match?.test(name))
  return matched
    ? { mock: matched, overlayMatched: true }
    : { mock: NO_PACK, overlayMatched: false }
}
