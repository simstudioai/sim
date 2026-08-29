'use client'

import type { ChangeEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import { Chip, ChipInput, cn, Tooltip } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import type { PanelTab } from '@/stores/panel'

interface PanelViewControlsProps {
  activeTab: PanelTab
  searchInputRef: RefObject<HTMLInputElement | null>
  onSearchChange: (query: string) => void
  onSearchNavigate: () => void
  onToolbarSelect: () => void
  onEditorSelect: () => void
  onLogsSelect: () => void
  showLogs?: boolean
  editorActions?: ReactNode
}

/**
 * Switches between the block catalog and editor while the Toolbar control morphs
 * into the catalog search field and the adjacent Editor control relocates smoothly.
 */
export function PanelViewControls({
  activeTab,
  searchInputRef,
  onSearchChange,
  onSearchNavigate,
  onToolbarSelect,
  onEditorSelect,
  onLogsSelect,
  showLogs = false,
  editorActions,
}: PanelViewControlsProps) {
  const toolbarActive = activeTab === 'toolbar'
  const editorActive = activeTab === 'editor'

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    onSearchNavigate()
  }

  return (
    <div
      className='relative flex h-[40px] flex-shrink-0 items-center justify-start gap-1 px-3.5'
      aria-label='Workflow panel view'
    >
      <div
        className={cn(
          'relative h-[30px] min-w-0 flex-shrink-0 rounded-lg transition-[width,flex-grow,background-color] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          toolbarActive
            ? 'w-0 grow'
            : 'w-[80px] grow-0 cursor-pointer hover-hover:bg-[var(--surface-active)]'
        )}
      >
        <ChipInput
          ref={searchInputRef}
          type='search'
          surface={toolbarActive ? 'field' : 'button'}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          placeholder='Search blocks...'
          aria-label={toolbarActive ? 'Search blocks' : undefined}
          aria-hidden={!toolbarActive}
          readOnly={!toolbarActive}
          tabIndex={toolbarActive ? 0 : -1}
          className='min-w-0'
          inputClassName={cn(
            'pl-4 transition-[opacity,transform] duration-150 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            toolbarActive
              ? 'translate-x-0 opacity-100 delay-75 motion-reduce:delay-0'
              : '-translate-x-1 opacity-0 delay-0'
          )}
        />

        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 flex items-center gap-1 px-2'
        >
          <Search className='size-[14px] flex-none text-[var(--text-icon)]' />
          <span
            aria-hidden='true'
            className={cn(
              'min-w-0 whitespace-nowrap text-[var(--text-body)] text-sm transition-[opacity,transform] duration-150 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              toolbarActive
                ? 'translate-x-1 opacity-0 delay-0'
                : 'translate-x-0 opacity-100 delay-100 motion-reduce:delay-0'
            )}
          >
            Toolbar
          </span>
        </span>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              onClick={onToolbarSelect}
              aria-label='Toolbar'
              aria-pressed={toolbarActive}
              tabIndex={toolbarActive ? -1 : 0}
              className={cn(
                'absolute inset-0 rounded-lg transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                toolbarActive ? 'pointer-events-none opacity-0' : 'opacity-100'
              )}
              aria-hidden={toolbarActive}
            />
          </Tooltip.Trigger>
          {!toolbarActive ? <Tooltip.Content side='bottom'>Toolbar</Tooltip.Content> : null}
        </Tooltip.Root>
      </div>

      <Chip active={editorActive} onClick={onEditorSelect} aria-pressed={editorActive}>
        Editor
      </Chip>

      {showLogs ? (
        <Chip
          active={activeTab === 'logs'}
          onClick={onLogsSelect}
          aria-pressed={activeTab === 'logs'}
        >
          Logs
        </Chip>
      ) : null}

      {editorActions ? (
        <div
          aria-hidden={!editorActive}
          className={cn(
            'absolute inset-y-0 end-3.5 flex items-center transition-opacity [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            !editorActive
              ? 'pointer-events-none opacity-0 delay-0 duration-0'
              : 'opacity-100 delay-300 duration-100 motion-reduce:delay-0'
          )}
        >
          {editorActions}
        </div>
      ) : null}
    </div>
  )
}
