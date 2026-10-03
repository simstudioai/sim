'use client'

import { ChipModalHeader, ChipModalTabs } from '@sim/emcn'
import { FileText, MoreVertical } from '@sim/emcn/icons'
import { WorkflowPreviewCanvas } from '@/app/(landing)/workflows/components/workflow-builder-preview/components/workflow-preview-canvas'

const DEPLOYMENT_TABS = [
  { value: 'general', label: 'General' },
  { value: 'api', label: 'API' },
  { value: 'mcp', label: 'MCP' },
  { value: 'chat', label: 'Chat' },
] as const

const VERSIONS = [
  {
    version: 'v3',
    name: 'Support replies',
    deployedBy: 'Morgan',
    timestamp: 'Sep 7, 9:41 AM',
    live: true,
  },
  {
    version: 'v2',
    name: 'Reply prompt',
    deployedBy: 'Alex',
    timestamp: 'Sep 6, 4:12 PM',
    live: false,
  },
  {
    version: 'v1',
    name: 'Initial deployment',
    deployedBy: 'Morgan',
    timestamp: 'Sep 3, 11:20 AM',
    live: false,
  },
] as const

/** The real deployment General tab: native modal tabs, live workflow, and version-history columns. */
export function WorkflowDeploymentPreview() {
  return (
    <div
      aria-hidden='true'
      inert
      data-workflow-deployment-preview
      className='pointer-events-none absolute @max-[400px]:top-8 top-12 left-6 w-[600px] select-none overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-small'
    >
      <ChipModalHeader onClose={() => {}}>Workflow Deployment</ChipModalHeader>
      <div className='space-y-4 px-4 py-3'>
        <ChipModalTabs
          tabs={DEPLOYMENT_TABS}
          value='general'
          onChange={() => {}}
          aria-label='Deployment settings'
        />
        <div>
          <p className='mb-1.5 pl-0.5 text-[var(--text-primary)]'>Live Workflow</p>
          <div className='relative h-[156px] overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--bg)]'>
            <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-[376px] w-[1210px] scale-[0.42]'>
              <WorkflowPreviewCanvas />
            </div>
          </div>
        </div>
        <div>
          <p className='mb-1.5 pl-0.5 text-[var(--text-primary)]'>Versions</p>
          <div className='overflow-hidden rounded-sm border border-[var(--border)] text-caption'>
            <div className='flex h-[30px] items-center bg-[var(--surface-1)] px-4 text-[var(--text-tertiary)]'>
              <span className='w-[180px] shrink-0'>Version</span>
              <span className='w-[140px] shrink-0'>Deployed by</span>
              <span className='min-w-0 flex-1'>Timestamp</span>
              <span className='w-[40px] shrink-0' />
            </div>
            {VERSIONS.map((version) => (
              <div
                key={version.version}
                className='flex h-9 items-center bg-[var(--surface-2)] px-4'
              >
                <div className='flex w-[180px] shrink-0 items-center gap-3 pr-2 text-[var(--text-primary)]'>
                  <span
                    className={
                      version.live
                        ? 'size-[6px] shrink-0 rounded-xs bg-[var(--indicator-active)]'
                        : 'size-[6px] shrink-0 rounded-xs bg-[var(--indicator-inactive)]'
                    }
                  />
                  <span className='shrink-0 text-[var(--text-tertiary)]'>{version.version}</span>
                  <span className='truncate'>{version.name}</span>
                  {version.live && (
                    <span className='shrink-0 text-[var(--text-tertiary)]'>(live)</span>
                  )}
                </div>
                <span className='w-[140px] shrink-0 truncate text-[var(--text-tertiary)]'>
                  {version.deployedBy}
                </span>
                <span className='min-w-0 flex-1 truncate text-[var(--text-tertiary)]'>
                  {version.timestamp}
                </span>
                <div className='flex w-[40px] shrink-0 justify-end gap-2 text-[var(--text-icon)]'>
                  <FileText className='size-3.5' />
                  <MoreVertical className='size-3.5' />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
