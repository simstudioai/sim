import type { FocusEvent, ReactNode, RefObject } from 'react'
import { Button, ChipInput, Label, Tooltip } from '@sim/emcn'
import {
  ArrowLeftRight,
  ArrowUp,
  Check,
  Clipboard,
  SquareArrowUpRight,
  TriangleAlert,
} from '@sim/emcn/icons'

interface FieldHeaderWandAction {
  isSearchActive: boolean
  searchQuery: string
  isStreaming: boolean
  onSearchClick: () => void
  onSearchBlur: () => void
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  onSearchCancel: () => void
  searchInputRef: RefObject<HTMLInputElement | null>
}

interface FieldHeaderCanonicalAction {
  mode: 'basic' | 'advanced'
  disabled?: boolean
  onToggle?: () => void
}

interface FieldHeaderCopyAction {
  copied: boolean
  onCopy: () => void
}

interface FieldHeaderExternalLinkAction {
  onClick: () => void
  tooltip: string
}

interface SubBlockFieldHeaderProps {
  title: string
  required?: boolean
  invalidJson?: boolean
  labelSuffix?: ReactNode
  wandAction?: FieldHeaderWandAction
  canonicalAction?: FieldHeaderCanonicalAction
  copyAction?: FieldHeaderCopyAction
  externalLinkAction?: FieldHeaderExternalLinkAction
}

/**
 * Presents a workflow field title and its contextual actions with one canonical
 * rhythm while leaving field state and persistence in the parent sub-block.
 */
export function SubBlockFieldHeader({
  title,
  required = false,
  invalidJson = false,
  labelSuffix,
  wandAction,
  canonicalAction,
  copyAction,
  externalLinkAction,
}: SubBlockFieldHeaderProps) {
  const canonicalTooltip =
    canonicalAction?.mode === 'advanced' ? 'Switch to selector' : 'Switch to manual ID'

  const handleWandBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('button')) return
    wandAction?.onSearchBlur()
  }

  return (
    <div className='flex min-h-5 items-center justify-between gap-1.5 pl-0.5'>
      <Label className='flex min-w-0 items-baseline gap-1.5 whitespace-nowrap font-normal text-[var(--text-body)] text-small'>
        <span className='truncate'>{title}</span>
        {required ? <span aria-label='Required'>*</span> : null}
        {labelSuffix}
        {invalidJson ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='inline-flex'>
                <TriangleAlert className='size-[14px] flex-shrink-0 text-[var(--text-error)]' />
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>Invalid JSON</Tooltip.Content>
          </Tooltip.Root>
        ) : null}
      </Label>
      <div className='flex min-w-0 flex-1 items-center justify-end gap-1'>
        {copyAction ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='quiet'
                size='icon'
                onClick={copyAction.onCopy}
                aria-label='Copy value'
              >
                {copyAction.copied ? (
                  <Check className='size-[14px] text-[var(--badge-green-text)]' />
                ) : (
                  <Clipboard className='size-[14px]' />
                )}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{copyAction.copied ? 'Copied!' : 'Copy'}</Tooltip.Content>
          </Tooltip.Root>
        ) : null}
        {wandAction ? (
          wandAction.isSearchActive ? (
            <div className='flex min-w-[148px] max-w-[280px] flex-1 items-center gap-1'>
              <ChipInput
                ref={wandAction.searchInputRef}
                value={wandAction.isStreaming ? 'Generating...' : wandAction.searchQuery}
                onChange={(event) => wandAction.onSearchChange(event.target.value)}
                onBlur={handleWandBlur}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    wandAction.searchQuery.trim() &&
                    !wandAction.isStreaming
                  ) {
                    wandAction.onSearchSubmit()
                  } else if (event.key === 'Escape') {
                    wandAction.onSearchCancel()
                  }
                }}
                disabled={wandAction.isStreaming}
                placeholder='Generate with AI...'
                aria-label='Generate with AI'
              />
              <Button
                type='button'
                variant='primary'
                size='icon'
                disabled={!wandAction.searchQuery.trim() || wandAction.isStreaming}
                onMouseDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  wandAction.onSearchSubmit()
                }}
                aria-label='Submit generation prompt'
              >
                <ArrowUp className='size-[14px]' />
              </Button>
            </div>
          ) : (
            <Button type='button' variant='active' size='sm' onClick={wandAction.onSearchClick}>
              Generate
            </Button>
          )
        ) : null}
        {externalLinkAction ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='quiet'
                size='icon'
                onClick={externalLinkAction.onClick}
                aria-label={externalLinkAction.tooltip}
              >
                <SquareArrowUpRight className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{externalLinkAction.tooltip}</Tooltip.Content>
          </Tooltip.Root>
        ) : null}
        {canonicalAction ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type='button'
                variant='quiet'
                size='icon'
                onClick={canonicalAction.onToggle}
                disabled={canonicalAction.disabled}
                aria-label={canonicalTooltip}
              >
                <ArrowLeftRight
                  className={
                    canonicalAction.mode === 'advanced'
                      ? 'size-[14px] text-[var(--text-primary)]'
                      : 'size-[14px]'
                  }
                />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>{canonicalTooltip}</Tooltip.Content>
          </Tooltip.Root>
        ) : null}
      </div>
    </div>
  )
}
