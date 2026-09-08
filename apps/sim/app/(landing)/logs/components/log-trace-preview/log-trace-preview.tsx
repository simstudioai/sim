'use client'

import { ChipModalTabs } from '@sim/emcn'
import { Workflow } from '@sim/emcn/icons'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'
import { PREVIEW_RUNS } from '@/app/(landing)/logs/components/log-history-preview/constants'
import { LogTracePanel } from '@/app/(landing)/logs/components/log-trace-preview/components/log-trace-panel'

/** A crop of Logs' Trace tab, using the product's tree and detail-pane layout. */
export function LogTracePreview() {
  return (
    <div className='absolute top-16 left-12 w-[640px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] text-small max-sm:top-8 max-sm:left-6'>
      <MenuPreviewHeader icon={Workflow} title='Support assistant' />
      <div className='px-3.5 py-3'>
        <ChipModalTabs
          tabs={[
            { value: 'overview', label: 'Overview' },
            { value: 'trace', label: 'Trace' },
          ]}
          value='trace'
          onChange={() => {}}
        />
      </div>
      <LogTracePanel run={PREVIEW_RUNS[0]} />
    </div>
  )
}
