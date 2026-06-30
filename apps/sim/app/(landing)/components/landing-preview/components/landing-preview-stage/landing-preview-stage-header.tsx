import { PanelRight, Workflow } from 'lucide-react'
import { X } from '@/components/emcn'

interface LandingPreviewStageHeaderProps {
  /** The staged resource's display name. */
  name: string
}

/**
 * The staged-resource header - a faithful copy of the workspace `PanelHeader`
 * (44px, `px-4`, `gap-1.5`) that sits above the workflow canvas in the "chat
 * everywhere" layout. There is no tab strip and no Deploy/Run: a workflow's
 * panel actions are `null` in the real header, so it carries only the staged
 * resource's identity - the lucide `Workflow` mark (`size-[14px]`, `--text-icon`)
 * and its name in chip geometry - plus the panel's close + collapse controls on
 * the right. Aligns to the chat pane's title bar so the two read as one header
 * row across the split.
 */
export function LandingPreviewStageHeader({ name }: LandingPreviewStageHeaderProps) {
  return (
    <div className='flex h-[44px] flex-shrink-0 items-center gap-1.5 border-[var(--border)] border-b px-4'>
      <div className='flex min-w-0 flex-1 items-center overflow-hidden'>
        <span className='inline-flex h-[30px] min-w-0 items-center justify-start gap-1.5 rounded-lg px-2 text-left'>
          <Workflow className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
          <span className='min-w-0 truncate text-[var(--text-primary)] text-sm'>{name}</span>
        </span>
      </div>
      <div className='ml-auto flex flex-shrink-0 items-center gap-1.5'>
        <span className='flex size-[30px] items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'>
          <X className='size-[14px] text-[var(--text-muted)]' />
        </span>
        <span className='-mr-[9px] flex size-[30px] items-center justify-center rounded-lg transition-colors hover-hover:bg-[var(--surface-active)]'>
          <PanelRight className='size-[16px] text-[var(--text-muted)]' />
        </span>
      </div>
    </div>
  )
}
