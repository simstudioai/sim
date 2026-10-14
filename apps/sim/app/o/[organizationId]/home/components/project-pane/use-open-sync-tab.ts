import { generateShortId } from '@sim/utils/id'
import { useQueryStates } from 'nuqs'
import {
  type PaneTab,
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'

/** Focuses the pane tab syncing this fork in this direction, opening one if there is none. */
export function useOpenSyncTab() {
  const [, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  return (childId: string, direction: Extract<PaneTab, { kind: 'sync' }>['direction']) =>
    void setParams((current) => {
      const existing = current.tabs.find(
        (tab) => tab.kind === 'sync' && tab.childId === childId && tab.direction === direction
      )
      if (existing) return { pane: existing.id }
      const id = generateShortId(8)
      return {
        pane: id,
        tabs: [...current.tabs, { kind: 'sync', id, childId, direction, step: 'mappings' }],
      }
    })
}
