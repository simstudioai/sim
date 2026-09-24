import type { ChangeEvent, Ref } from 'react'
import { Button, ChipInput, cn } from '@sim/emcn'
import { ArrowDown, ArrowUp, X } from '@sim/emcn/icons'

export interface CodeSearchOverlayProps {
  /** The attached terminal panel has a joined lower edge and wider result tally. */
  appearance?: 'floating' | 'attached'
  /** Position relative to the owning code panel. */
  className: string
  /** Logs use the 30px chip field; previews and terminal output use compact search. */
  inputKind: 'chip' | 'plain'
  inputRef: Ref<HTMLInputElement>
  query: string
  onQueryChange: (query: string) => void
  matchCount: number
  currentMatchIndex: number
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

/** Shared controls for searching a Code.Viewer without owning its search state. */
export function CodeSearchOverlay({
  appearance = 'floating',
  className,
  inputKind,
  inputRef,
  query,
  onQueryChange,
  matchCount,
  currentMatchIndex,
  onPrevious,
  onNext,
  onClose,
}: CodeSearchOverlayProps) {
  const attached = appearance === 'attached'
  const inputProps = {
    ref: inputRef,
    type: 'text',
    value: query,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onQueryChange(event.target.value),
    placeholder: 'Search...',
    'aria-label': 'Search code',
  } as const
  const actionProps = {
    type: 'button' as const,
    variant: 'ghost' as const,
    iconPadding: attached ? ('md' as const) : ('sm' as const),
    className: attached ? '-m-1.5' : undefined,
  }
  const iconClass = attached ? 'size-[14px]' : 'size-[12px]'

  return (
    <div
      role={attached ? undefined : 'presentation'}
      className={cn(
        'absolute z-30 flex h-[34px] items-center gap-1.5 border border-[var(--border)] px-1.5 shadow-xs',
        attached ? 'rounded-b-[4px] border-t-0 bg-[var(--bg)]' : 'rounded-sm bg-[var(--surface-1)]',
        className
      )}
      onClick={(event) => event.stopPropagation()}
      data-toolbar-root={attached ? true : undefined}
      data-search-active={attached ? true : undefined}
    >
      {inputKind === 'chip' ? (
        <ChipInput {...inputProps} className='mr-0.5 w-[94px]' />
      ) : (
        <ChipInput {...inputProps} appearance='compactSearch' className='mr-0.5 w-[94px]' />
      )}
      <span
        aria-live='polite'
        aria-atomic='true'
        className={cn(
          attached ? 'w-[58px] text-xs' : 'min-w-[45px] text-center text-xs',
          matchCount > 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
        )}
      >
        {matchCount > 0
          ? `${currentMatchIndex + 1}/${matchCount}`
          : attached
            ? 'No results'
            : '0/0'}
      </span>
      <Button
        {...actionProps}
        onClick={onPrevious}
        disabled={matchCount === 0}
        aria-label='Previous match'
      >
        <ArrowUp className={iconClass} />
      </Button>
      <Button {...actionProps} onClick={onNext} disabled={matchCount === 0} aria-label='Next match'>
        <ArrowDown className={iconClass} />
      </Button>
      <Button {...actionProps} onClick={onClose} aria-label='Close search'>
        <X className={iconClass} />
      </Button>
    </div>
  )
}
