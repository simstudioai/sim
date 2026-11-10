'use client'

import { useQueryStates } from 'nuqs'
import { usePageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import { runListParams } from '@/platform/lib/workspace-views'

interface RunPageCommandsInput {
  /** The CSV download for the current period and filters. */
  exportHref: string
  canExport: boolean
}

/**
 * What the Logs page offers in search, as legacy's logs page did: Export for a viewer who may export,
 * and a switch to whichever of the Runs and Dashboard views is not showing.
 */
export function useRunPageCommands({ exportHref, canExport }: RunPageCommandsInput) {
  const [view, setView] = useQueryStates(runListParams, { history: 'replace', shallow: true })
  usePageCommands([
    ...(canExport
      ? [
          {
            id: 'logs-export',
            label: 'Export',
            run: () => {
              const link = document.createElement('a')
              link.href = exportHref
              link.download = ''
              link.click()
            },
          },
        ]
      : []),
    view.view === 'dashboard'
      ? { id: 'logs-show-runs', label: 'Switch to Runs', run: () => void setView({ view: null }) }
      : {
          id: 'logs-show-dashboard',
          label: 'Switch to Dashboard',
          run: () => void setView({ view: 'dashboard' }),
        },
  ])
}
