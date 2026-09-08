'use client'

import type { ComponentType } from 'react'
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TabStrip,
  type TabStripItem,
  Tooltip,
} from '@sim/emcn'
import {
  FileText,
  PanelLeft,
  PlayOutline,
  Plus,
  Table as TableIcon,
  Workflow,
} from '@sim/emcn/icons'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import type { LeadRecord } from '@/app/(landing)/tables/components/tables-records-preview/data'
import { TablesRecordsTable } from '@/app/(landing)/tables/components/tables-records-preview/tables-records-table'
import {
  RESOURCE_HEADER_CLASSES,
  RESOURCE_TAB_ICON_BUTTON_CLASS,
  RESOURCE_TAB_ICON_CLASS,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

export type HeroResourceId = 'workflow' | 'table' | 'brief'

interface HeroResourceDefinition {
  id: HeroResourceId
  title: string
  icon: ComponentType<{ className?: string }>
}

const HERO_RESOURCES: readonly HeroResourceDefinition[] = [
  { id: 'workflow', title: 'Lead enrichment', icon: Workflow },
  { id: 'table', title: 'Qualified leads', icon: TableIcon },
  { id: 'brief', title: 'lead-enrichment-brief.md', icon: FileText },
] as const

const TABLE_ROWS: readonly LeadRecord[] = [
  { id: 'northstar', contact: 'Maya Chen', company: 'Northstar', score: 94, status: 'Qualified' },
  { id: 'arcadia', contact: 'Jon Bell', company: 'Arcadia', score: 88, status: 'Qualified' },
  { id: 'hearth', contact: 'Priya Shah', company: 'Hearth', score: 79, status: 'Review' },
  { id: 'lattice', contact: 'Noah Kim', company: 'Lattice', score: 72, status: 'Review' },
] as const

interface HeroResourcePanelProps {
  activeId: HeroResourceId | null
  builtCount: number
  openIds: readonly HeroResourceId[]
  workflowKey: number
  onActiveChange: (id: HeroResourceId) => void
  onClose: () => void
  onCloseResource: (id: HeroResourceId) => void
  onOpenResource: (id: HeroResourceId) => void
  onRunWorkflow: () => void
}

function HeroFileResource() {
  return (
    <div className='h-full overflow-y-auto bg-[var(--bg)]'>
      <article className='mx-auto max-w-[520px] px-8 py-10 max-lg:px-6'>
        <div className='mb-8 flex items-center gap-2 text-[var(--text-muted)] text-caption'>
          <FileText className='size-[14px] text-[var(--text-icon)]' />
          Markdown
          <span aria-hidden='true'>/</span>
          Updated just now
        </div>
        <h2 className='text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.015em]'>
          Lead enrichment brief
        </h2>
        <p className='mt-4 text-[var(--text-secondary)] text-sm leading-6'>
          Score every inbound signup against firmographic and engagement signals before routing
          qualified leads to the sales team.
        </p>
        <div className='mt-8 border-[var(--border)] border-t pt-6'>
          <h3 className='text-[var(--text-primary)] text-sm'>Qualification rules</h3>
          <ul className='mt-3 list-disc space-y-2 pl-5 text-[var(--text-secondary)] text-sm leading-6'>
            <li>Company size is at least 200 employees</li>
            <li>Lead matches an active sales territory</li>
            <li>Product intent score is above 70</li>
          </ul>
        </div>
        <div className='mt-8 border-[var(--border)] border-t pt-6'>
          <h3 className='text-[var(--text-primary)] text-sm'>Routing</h3>
          <p className='mt-3 text-[var(--text-secondary)] text-sm leading-6'>
            Post qualified leads to the sales channel and save the full enrichment record in the
            Qualified leads table.
          </p>
        </div>
      </article>
    </div>
  )
}

function resourceIcon(resource: HeroResourceDefinition) {
  const Icon = resource.icon
  return <Icon className='size-[16px] shrink-0 text-[var(--text-icon)]' />
}

/**
 * Landing-safe version of the production Mothership resource panel. It uses
 * the real floating TabStrip and resource-header geometry while keeping all
 * data local to the public demo.
 */
export function HeroResourcePanel({
  activeId,
  builtCount,
  openIds,
  workflowKey,
  onActiveChange,
  onClose,
  onCloseResource,
  onOpenResource,
  onRunWorkflow,
}: HeroResourcePanelProps) {
  const openResources = HERO_RESOURCES.filter((resource) => openIds.includes(resource.id))
  const tabs: TabStripItem[] = openResources.map((resource) => ({
    id: resource.id,
    title: resource.title,
    icon: resourceIcon(resource),
    active: resource.id === activeId,
  }))

  const workflowActions =
    activeId === 'workflow' ? (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='subtle'
            onClick={onRunWorkflow}
            className={RESOURCE_TAB_ICON_BUTTON_CLASS}
            aria-label='Run workflow'
          >
            <PlayOutline className={RESOURCE_TAB_ICON_CLASS} />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>Run workflow</Tooltip.Content>
      </Tooltip.Root>
    ) : null

  return (
    <div
      className={cn('relative flex h-full flex-col bg-[var(--bg)]', RESOURCE_HEADER_CLASSES.layout)}
    >
      <TabStrip
        tabs={tabs}
        onSelect={(id) => onActiveChange(id as HeroResourceId)}
        onClose={(id) => onCloseResource(id as HeroResourceId)}
        variant='floating'
        className={RESOURCE_HEADER_CLASSES.stripGeometry}
        newTabControl={
          <DropdownMenu>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type='button'
                    variant='subtle'
                    className={RESOURCE_TAB_ICON_BUTTON_CLASS}
                    aria-label='Add resource'
                  >
                    <Plus className={RESOURCE_TAB_ICON_CLASS} />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip.Trigger>
              <Tooltip.Content side='bottom'>Add resource</Tooltip.Content>
            </Tooltip.Root>
            <DropdownMenuContent align='start' sideOffset={6}>
              {HERO_RESOURCES.map((resource) => {
                const Icon = resource.icon
                return (
                  <DropdownMenuItem key={resource.id} onSelect={() => onOpenResource(resource.id)}>
                    <Icon className='size-[14px] text-[var(--text-icon)]' />
                    {resource.title}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        }
        endActions={workflowActions}
      />

      <div className='min-h-0 flex-1'>
        {activeId === 'workflow' ? (
          <HeroWorkflowStage key={workflowKey} builtCount={builtCount} interactive />
        ) : activeId === 'table' ? (
          <TablesRecordsTable initialRows={TABLE_ROWS} />
        ) : activeId === 'brief' ? (
          <HeroFileResource />
        ) : (
          <div className='flex h-full flex-col items-center justify-center gap-3 text-center'>
            <div className='flex size-9 items-center justify-center rounded-lg bg-[var(--surface-3)]'>
              <Plus className='size-[16px] text-[var(--text-icon)]' />
            </div>
            <div>
              <p className='text-[var(--text-body)] text-sm'>Open a resource</p>
              <p className='mt-1 text-[var(--text-muted)] text-caption'>
                Add a workflow, table, or file to this task.
              </p>
            </div>
          </div>
        )}
      </div>

      <div
        className={cn('z-30', RESOURCE_HEADER_CLASSES.overlay, RESOURCE_HEADER_CLASSES.endPosition)}
      >
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='ghost'
              size={null}
              onClick={onClose}
              className="after:-translate-x-1/2 after:-translate-y-1/2 relative size-[var(--resource-header-toggle-size)] rounded-[8px] after:absolute after:top-1/2 after:left-1/2 after:size-[var(--resource-header-toggle-hit-size)] after:content-[''] hover-hover:bg-[var(--surface-active)]"
              aria-label='Collapse resource view'
            >
              <PanelLeft className='-scale-x-100 size-[16px] text-[var(--text-icon)]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>Collapse resource view</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  )
}
