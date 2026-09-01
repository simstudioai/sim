import { Chip, cn } from '@sim/emcn'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from '@sim/emcn/icons'

interface PreviewNavigationControls {
  current: number
  total: number
  label: string
  onPrevious: () => void
  onNext: () => void
  canPrevious?: boolean
  canNext?: boolean
}

interface PreviewZoomControls {
  label: string
  onZoomOut: () => void
  onZoomIn: () => void
  canZoomOut?: boolean
  canZoomIn?: boolean
  onReset?: () => void
}

interface PreviewToolbarProps {
  navigation?: PreviewNavigationControls
  zoom?: PreviewZoomControls
  className?: string
}

export function PreviewToolbar({ navigation, zoom, className }: PreviewToolbarProps) {
  return (
    <div
      className={cn(
        // Matches the resource tab strip stacked directly above it: a 40px
        // content box over a 1px border. `py-1` around a 30px chip came to 39px,
        // near enough to read as a mistake rather than as a different bar, and
        // the chips themselves still sat taller than the 26px tabs.
        'flex h-[41px] shrink-0 items-center justify-between border-[var(--border)] border-b bg-[var(--surface-1)] px-2',
        className
      )}
    >
      <div className='flex items-center gap-1'>
        {navigation && <PreviewNavigationControls {...navigation} />}
      </div>
      <div className='flex items-center gap-1'>{zoom && <PreviewZoomControls {...zoom} />}</div>
    </div>
  )
}

function PreviewNavigationControls({
  current,
  total,
  label,
  onPrevious,
  onNext,
  canPrevious = current > 1,
  canNext = current < total,
}: PreviewNavigationControls) {
  return (
    <>
      <Chip
        leftIcon={ChevronLeft}
        onClick={onPrevious}
        disabled={!canPrevious}
        aria-label={`Previous ${label}`}
      />
      <span className='min-w-[4.5rem] text-center text-[var(--text-body)] text-sm'>
        {total > 0 ? `${current} / ${total}` : '0 / 0'}
      </span>
      <Chip
        leftIcon={ChevronRight}
        onClick={onNext}
        disabled={!canNext}
        aria-label={`Next ${label}`}
      />
    </>
  )
}

function PreviewZoomControls({
  label,
  onZoomOut,
  onZoomIn,
  canZoomOut = true,
  canZoomIn = true,
  onReset,
}: PreviewZoomControls) {
  return (
    <>
      {onReset && (
        <Chip onClick={onReset} aria-label='Reset zoom'>
          Reset
        </Chip>
      )}
      <Chip leftIcon={ZoomOut} onClick={onZoomOut} disabled={!canZoomOut} aria-label='Zoom out' />
      <span className='min-w-[3.25rem] text-center text-[var(--text-body)] text-sm'>{label}</span>
      <Chip leftIcon={ZoomIn} onClick={onZoomIn} disabled={!canZoomIn} aria-label='Zoom in' />
    </>
  )
}
