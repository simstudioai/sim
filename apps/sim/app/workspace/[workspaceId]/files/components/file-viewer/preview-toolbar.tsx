import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

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
        'flex shrink-0 items-center justify-between border-[var(--border)] border-b bg-[var(--surface-1)] px-3 py-1.5',
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
      <Button
        variant='ghost'
        size='sm'
        onClick={onPrevious}
        disabled={!canPrevious}
        className='size-6 p-0 text-[var(--text-icon)]'
        aria-label={`Previous ${label}`}
      >
        <ChevronLeft className='size-[14px]' />
      </Button>
      <span className='min-w-[5rem] text-center text-[12px] text-[var(--text-secondary)]'>
        {total > 0 ? `${current} / ${total}` : '0 / 0'}
      </span>
      <Button
        variant='ghost'
        size='sm'
        onClick={onNext}
        disabled={!canNext}
        className='size-6 p-0 text-[var(--text-icon)]'
        aria-label={`Next ${label}`}
      >
        <ChevronRight className='size-[14px]' />
      </Button>
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
        <Button
          variant='ghost'
          size='sm'
          onClick={onReset}
          className='h-6 px-2 text-[11px]'
          aria-label='Reset zoom'
        >
          Reset
        </Button>
      )}
      <Button
        variant='ghost'
        size='sm'
        onClick={onZoomOut}
        disabled={!canZoomOut}
        className='size-6 p-0 text-[var(--text-icon)]'
        aria-label='Zoom out'
      >
        <ZoomOut className='size-[14px]' />
      </Button>
      <span className='min-w-[3rem] text-center text-[12px] text-[var(--text-secondary)]'>
        {label}
      </span>
      <Button
        variant='ghost'
        size='sm'
        onClick={onZoomIn}
        disabled={!canZoomIn}
        className='size-6 p-0 text-[var(--text-icon)]'
        aria-label='Zoom in'
      >
        <ZoomIn className='size-[14px]' />
      </Button>
    </>
  )
}
