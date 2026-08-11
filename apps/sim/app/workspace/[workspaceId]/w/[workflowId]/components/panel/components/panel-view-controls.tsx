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
  editorActions,
}: PanelViewControlsProps) {
  const toolbarActive = activeTab === 'toolbar'

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
          'relative h-[30px] min-w-0 flex-shrink-0 basis-[30px] rounded-lg transition-[flex-grow,background-color] duration-200 [transition-timing-function:cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none',
          toolbarActive ? 'grow' : 'grow-0 cursor-pointer hover-hover:bg-[var(--surface-active)]'
        )}
      >
        <ChipInput
          ref={searchInputRef}
          icon={Search}
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
            'transition-[opacity,transform] duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            toolbarActive
              ? 'translate-x-0 opacity-100 delay-75 motion-reduce:delay-0'
              : '-translate-x-1 opacity-0 delay-0'
          )}
        />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              onClick={onToolbarSelect}
              aria-label='Open Toolbar'
              aria-pressed={toolbarActive}
              tabIndex={toolbarActive ? -1 : 0}
              className={cn(
                'absolute inset-0 rounded-lg transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                toolbarActive ? 'pointer-events-none opacity-0' : 'opacity-100'
              )}
              aria-hidden={toolbarActive}
            />
          </Tooltip.Trigger>
          {!toolbarActive ? <Tooltip.Content side='bottom'>Toolbar</Tooltip.Content> : null}
        </Tooltip.Root>
      </div>

      <Chip
        active={activeTab === 'editor'}
        onClick={onEditorSelect}
        aria-pressed={activeTab === 'editor'}
      >
        Editor
      </Chip>

      {editorActions ? (
        <div
          aria-hidden={toolbarActive}
          className={cn(
            'absolute inset-y-0 end-3.5 flex items-center transition-opacity [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
            toolbarActive
              ? 'pointer-events-none opacity-0 delay-0 duration-0'
              : 'opacity-100 delay-200 duration-100 motion-reduce:delay-0'
          )}
        >
          {editorActions}
        </div>
      ) : null}
    </div>
  )
}
