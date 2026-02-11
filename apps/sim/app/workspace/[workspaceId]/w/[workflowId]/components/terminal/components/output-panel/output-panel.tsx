'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  Clipboard,
  Database,
  MoreHorizontal,
  Palette,
  Pause,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import {
  Button,
  Code,
  Input,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { FilterPopover } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/filter-popover'
import { OutputContextMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/output-panel/components/output-context-menu'
import { StructuredOutput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/output-panel/components/structured-output'
import { ToggleButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/toggle-button'
import type {
  BlockInfo,
  TerminalFilters,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import type { ConsoleEntry } from '@/stores/terminal'
import { useTerminalStore } from '@/stores/terminal'

interface OutputCodeContentProps {
  code: string
  language: 'javascript' | 'json'
  wrapText: boolean
  searchQuery: string | undefined
  currentMatchIndex: number
  onMatchCountChange: (count: number) => void
  contentRef: React.RefObject<HTMLDivElement | null>
}

const OutputCodeContent = React.memo(function OutputCodeContent({
  code,
  language,
  wrapText,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  contentRef,
}: OutputCodeContentProps) {
  return (
    <Code.Viewer
      code={code}
      showGutter
      language={language}
      className='m-0 min-h-full rounded-none border-0 bg-[var(--surface-1)] dark:bg-[var(--surface-1)]'
      paddingLeft={8}
      gutterStyle={{ backgroundColor: 'transparent' }}
      wrapText={wrapText}
      searchQuery={searchQuery}
      currentMatchIndex={currentMatchIndex}
      onMatchCountChange={onMatchCountChange}
      contentRef={contentRef}
      virtualized
      showCollapseColumn={language === 'json'}
    />
  )
})

/**
 * Props for the OutputPanel component
 * Store-backed settings (wrapText, openOnRun, structuredView, outputPanelWidth)
 * are accessed directly from useTerminalStore to reduce prop drilling.
 */
export interface OutputPanelProps {
  selectedEntry: ConsoleEntry
  handleOutputPanelResizeMouseDown: (e: React.MouseEvent) => void
  handleHeaderClick: () => void
  isExpanded: boolean
  expandToLastHeight: () => void
  showInput: boolean
  setShowInput: (show: boolean) => void
  hasInputData: boolean
  isPlaygroundEnabled: boolean
  shouldShowTrainingButton: boolean
  isTraining: boolean
  handleTrainingClick: (e: React.MouseEvent) => void
  showCopySuccess: boolean
  handleCopy: () => void
  filteredEntries: ConsoleEntry[]
  handleExportConsole: (e: React.MouseEvent) => void
  hasActiveFilters: boolean
  handleClearConsole: (e: React.MouseEvent) => void
  shouldShowCodeDisplay: boolean
  outputDataStringified: string
  outputData: unknown
  handleClearConsoleFromMenu: () => void
  filters: TerminalFilters
  toggleBlock: (blockId: string) => void
  toggleStatus: (status: 'error' | 'info') => void
  uniqueBlocks: BlockInfo[]
}

/**
 * Output panel component that manages its own search state.
 * Accesses store-backed settings directly to reduce prop drilling.
 */
export const OutputPanel = React.memo(function OutputPanel({
  selectedEntry,
  handleOutputPanelResizeMouseDown,
  handleHeaderClick,
  isExpanded,
  expandToLastHeight,
  showInput,
  setShowInput,
  hasInputData,
  isPlaygroundEnabled,
  shouldShowTrainingButton,
  isTraining,
  handleTrainingClick,
  showCopySuccess,
  handleCopy,
  filteredEntries,
  handleExportConsole,
  hasActiveFilters,
  handleClearConsole,
  shouldShowCodeDisplay,
  outputDataStringified,
  outputData,
  handleClearConsoleFromMenu,
  filters,
  toggleBlock,
  toggleStatus,
  uniqueBlocks,
}: OutputPanelProps) {
  // Access store-backed settings directly to reduce prop drilling
  const outputPanelWidth = useTerminalStore((state) => state.outputPanelWidth)
  const wrapText = useTerminalStore((state) => state.wrapText)
  const setWrapText = useTerminalStore((state) => state.setWrapText)
  const openOnRun = useTerminalStore((state) => state.openOnRun)
  const setOpenOnRun = useTerminalStore((state) => state.setOpenOnRun)
  const structuredView = useTerminalStore((state) => state.structuredView)
  const setStructuredView = useTerminalStore((state) => state.setStructuredView)

  const outputContentRef = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [outputOptionsOpen, setOutputOptionsOpen] = useState(false)
  const {
    isSearchActive: isOutputSearchActive,
    searchQuery: outputSearchQuery,
    setSearchQuery: setOutputSearchQuery,
    matchCount,
    currentMatchIndex,
    activateSearch: activateOutputSearch,
    closeSearch: closeOutputSearch,
    goToNextMatch,
    goToPreviousMatch,
    handleMatchCountChange,
    searchInputRef: outputSearchInputRef,
  } = useCodeViewerFeatures({
    contentRef: outputContentRef,
    externalWrapText: wrapText,
    onWrapTextChange: setWrapText,
  })

  // Context menu state for output panel
  const [hasSelection, setHasSelection] = useState(false)
  const [storedSelectionText, setStoredSelectionText] = useState('')
  const {
    isOpen: isOutputMenuOpen,
    position: outputMenuPosition,
    menuRef: outputMenuRef,
    handleContextMenu: handleOutputContextMenu,
    closeMenu: closeOutputMenu,
  } = useContextMenu()

  const handleOutputPanelContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const selection = window.getSelection()
      const selectionText = selection?.toString() || ''
      setStoredSelectionText(selectionText)
      setHasSelection(selectionText.length > 0)
      handleOutputContextMenu(e)
    },
    [handleOutputContextMenu]
  )

  const handleCopySelection = useCallback(() => {
    if (storedSelectionText) {
      navigator.clipboard.writeText(storedSelectionText)
    }
  }, [storedSelectionText])

  // Memoized callbacks to avoid inline arrow functions
  const handleToggleStructuredView = useCallback(() => {
    setStructuredView(!structuredView)
  }, [structuredView, setStructuredView])

  const handleToggleWrapText = useCallback(() => {
    setWrapText(!wrapText)
  }, [wrapText, setWrapText])

  const handleToggleOpenOnRun = useCallback(() => {
    setOpenOnRun(!openOnRun)
  }, [openOnRun, setOpenOnRun])

  const handleCopyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleCopy()
    },
    [handleCopy]
  )

  const handleSearchClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      activateOutputSearch()
    },
    [activateOutputSearch]
  )

  const handleCloseSearchClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      closeOutputSearch()
    },
    [closeOutputSearch]
  )

  const handleOutputButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!isExpanded) {
        expandToLastHeight()
      }
      if (showInput) setShowInput(false)
    },
    [isExpanded, expandToLastHeight, showInput, setShowInput]
  )

  const handleInputButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!isExpanded) {
        expandToLastHeight()
      }
      setShowInput(true)
    },
    [isExpanded, expandToLastHeight, setShowInput]
  )

  const handleToggleButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      handleHeaderClick()
    },
    [handleHeaderClick]
  )

  /**
   * Track text selection state for context menu.
   * Skip updates when the context menu is open to prevent the selection
   * state from changing mid-click (which would disable the copy button).
   */
  useEffect(() => {
    const handleSelectionChange = () => {
      if (isOutputMenuOpen) return

      const selection = window.getSelection()
      setHasSelection(Boolean(selection && selection.toString().length > 0))
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [isOutputMenuOpen])

  // Memoize the search query for structured output to avoid re-renders
  const structuredSearchQuery = useMemo(
    () => (isOutputSearchActive ? outputSearchQuery : undefined),
    [isOutputSearchActive, outputSearchQuery]
  )

  return (
    <>
      <div
        className='absolute top-0 right-0 bottom-0 flex flex-col border-[var(--border)] border-l bg-[var(--surface-1)]'
        style={{ width: `${outputPanelWidth}px` }}
      >
        {/* Horizontal Resize Handle */}
        <div
          className='-ml-[4px] absolute top-0 bottom-0 left-0 z-20 w-[8px] cursor-ew-resize'
          onMouseDown={handleOutputPanelResizeMouseDown}
          role='separator'
          aria-label='Resize output panel'
          aria-orientation='vertical'
        />

        {/* Header */}
        <div
          className='group flex h-[30px] flex-shrink-0 cursor-pointer items-center justify-between bg-[var(--surface-1)] pr-[16px] pl-[10px]'
          onClick={handleHeaderClick}
        >
          <div className='flex items-center'>
            <Button
              variant='ghost'
              className={clsx(
                'px-[8px] py-[6px] text-[12px]',
                !showInput ? '!text-[var(--text-primary)]' : '!text-[var(--text-tertiary)]'
              )}
              onClick={handleOutputButtonClick}
              aria-label='Show output'
            >
              Output
            </Button>
            {hasInputData && (
              <Button
                variant='ghost'
                className={clsx(
                  'px-[8px] py-[6px] text-[12px]',
                  showInput ? '!text-[var(--text-primary)]' : '!text-[var(--text-tertiary)]'
                )}
                onClick={handleInputButtonClick}
                aria-label='Show input'
              >
                Input
              </Button>
            )}
          </div>
          <div className='flex flex-shrink-0 items-center gap-[8px]'>
            {/* Unified filter popover */}
            {filteredEntries.length > 0 && (
              <FilterPopover
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                filters={filters}
                toggleStatus={toggleStatus}
                toggleBlock={toggleBlock}
                uniqueBlocks={uniqueBlocks}
                hasActiveFilters={hasActiveFilters}
              />
            )}

            {isOutputSearchActive ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={handleCloseSearchClick}
                    aria-label='Close search'
                    className='!p-1.5 -m-1.5'
                  >
                    <X className='h-[12px] w-[12px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>Close search</span>
                </Tooltip.Content>
              </Tooltip.Root>
            ) : (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={handleSearchClick}
                    aria-label='Search in output'
                    className='!p-1.5 -m-1.5'
                  >
                    <Search className='h-[12px] w-[12px]' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>Search</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {isPlaygroundEnabled && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Link href='/playground'>
                    <Button
                      variant='ghost'
                      aria-label='Component Playground'
                      className='!p-1.5 -m-1.5'
                    >
                      <Palette className='h-[12px] w-[12px]' />
                    </Button>
                  </Link>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>Component Playground</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            {shouldShowTrainingButton && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={handleTrainingClick}
                    aria-label={isTraining ? 'Stop training' : 'Train Copilot'}
                    className={clsx(
                      '!p-1.5 -m-1.5',
                      isTraining && 'text-orange-600 dark:text-orange-400'
                    )}
                  >
                    {isTraining ? (
                      <Pause className='h-[12px] w-[12px]' />
                    ) : (
                      <Database className='h-[12px] w-[12px]' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>{isTraining ? 'Stop Training' : 'Train Copilot'}</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={handleCopyClick}
                  aria-label='Copy output'
                  className='!p-1.5 -m-1.5'
                >
                  {showCopySuccess ? (
                    <Check className='h-[12px] w-[12px]' />
                  ) : (
                    <Clipboard className='h-[12px] w-[12px]' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>{showCopySuccess ? 'Copied' : 'Copy output'}</span>
              </Tooltip.Content>
            </Tooltip.Root>
            {filteredEntries.length > 0 && (
              <>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={handleExportConsole}
                      aria-label='Download console CSV'
                      className='!p-1.5 -m-1.5'
                    >
                      <ArrowDownToLine className='h-3 w-3' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span>Download CSV</span>
                  </Tooltip.Content>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={handleClearConsole}
                      aria-label='Clear console'
                      className='!p-1.5 -m-1.5'
                    >
                      <Trash2 className='h-3 w-3' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <Tooltip.Shortcut keys='⌘D'>Clear console</Tooltip.Shortcut>
                  </Tooltip.Content>
                </Tooltip.Root>
              </>
            )}
            <Popover open={outputOptionsOpen} onOpenChange={setOutputOptionsOpen} size='sm'>
              <PopoverTrigger asChild>
                <Button
                  variant='ghost'
                  onClick={(e) => e.stopPropagation()}
                  aria-label='Terminal options'
                  className='!p-1.5 -m-1.5'
                >
                  <MoreHorizontal className='h-3.5 w-3.5' />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side='bottom'
                align='end'
                sideOffset={4}
                collisionPadding={0}
                onClick={(e) => e.stopPropagation()}
                style={{ minWidth: '140px', maxWidth: '160px' }}
                className='gap-[2px]'
              >
                <PopoverItem
                  active={structuredView}
                  showCheck={structuredView}
                  onClick={handleToggleStructuredView}
                >
                  <span>Structured view</span>
                </PopoverItem>
                <PopoverItem active={wrapText} showCheck={wrapText} onClick={handleToggleWrapText}>
                  <span>Wrap text</span>
                </PopoverItem>
                <PopoverItem
                  active={openOnRun}
                  showCheck={openOnRun}
                  onClick={handleToggleOpenOnRun}
                >
                  <span>Open on run</span>
                </PopoverItem>
              </PopoverContent>
            </Popover>
            <ToggleButton isExpanded={isExpanded} onClick={handleToggleButtonClick} />
          </div>
        </div>

        {/* Search Overlay */}
        {isOutputSearchActive && (
          <div
            className='absolute top-[30px] right-[8px] z-30 flex h-[34px] items-center gap-[6px] rounded-b-[4px] border border-[var(--border)] border-t-0 bg-[var(--surface-1)] px-[6px] shadow-sm'
            onClick={(e) => e.stopPropagation()}
            data-toolbar-root
            data-search-active='true'
          >
            <Input
              ref={outputSearchInputRef}
              type='text'
              value={outputSearchQuery}
              onChange={(e) => setOutputSearchQuery(e.target.value)}
              placeholder='Search...'
              className='mr-[2px] h-[23px] w-[94px] text-[12px]'
            />
            <span
              className={clsx(
                'w-[58px] font-medium text-[11px]',
                matchCount > 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
              )}
            >
              {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : 'No results'}
            </span>
            <Button
              variant='ghost'
              onClick={goToPreviousMatch}
              aria-label='Previous match'
              className='!p-1.5 -m-1.5'
              disabled={matchCount === 0}
            >
              <ArrowUp className='h-[12px] w-[12px]' />
            </Button>
            <Button
              variant='ghost'
              onClick={goToNextMatch}
              aria-label='Next match'
              className='!p-1.5 -m-1.5'
              disabled={matchCount === 0}
            >
              <ArrowDown className='h-[12px] w-[12px]' />
            </Button>
            <Button
              variant='ghost'
              onClick={closeOutputSearch}
              aria-label='Close search'
              className='!p-1.5 -m-1.5'
            >
              <X className='h-[12px] w-[12px]' />
            </Button>
          </div>
        )}

        {/* Content */}
        <div
          className={clsx('flex-1 overflow-y-auto', !wrapText && 'overflow-x-auto')}
          onContextMenu={handleOutputPanelContextMenu}
        >
          {shouldShowCodeDisplay ? (
            <OutputCodeContent
              code={selectedEntry.input.code}
              language={(selectedEntry.input.language as 'javascript' | 'json') || 'javascript'}
              wrapText={wrapText}
              searchQuery={structuredSearchQuery}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
              contentRef={outputContentRef}
            />
          ) : structuredView ? (
            <StructuredOutput
              data={outputData}
              wrapText={wrapText}
              isError={!showInput && Boolean(selectedEntry.error)}
              isRunning={!showInput && Boolean(selectedEntry.isRunning)}
              className='min-h-full'
              searchQuery={structuredSearchQuery}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
              contentRef={outputContentRef}
            />
          ) : (
            <OutputCodeContent
              code={outputDataStringified}
              language='json'
              wrapText={wrapText}
              searchQuery={structuredSearchQuery}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
              contentRef={outputContentRef}
            />
          )}
        </div>
      </div>

      {/* Output Panel Context Menu */}
      <OutputContextMenu
        isOpen={isOutputMenuOpen}
        position={outputMenuPosition}
        menuRef={outputMenuRef}
        onClose={closeOutputMenu}
        onCopySelection={handleCopySelection}
        onCopyAll={handleCopy}
        onSearch={activateOutputSearch}
        structuredView={structuredView}
        onToggleStructuredView={handleToggleStructuredView}
        wrapText={wrapText}
        onToggleWrap={handleToggleWrapText}
        openOnRun={openOnRun}
        onToggleOpenOnRun={handleToggleOpenOnRun}
        onClearConsole={handleClearConsoleFromMenu}
        hasSelection={hasSelection}
      />
    </>
  )
})
