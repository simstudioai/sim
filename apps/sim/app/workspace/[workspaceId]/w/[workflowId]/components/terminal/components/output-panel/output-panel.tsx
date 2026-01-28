'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronDown,
  Clipboard,
  Database,
  FilterX,
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
import { OutputContextMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/output-panel/components/output-context-menu'
import { StructuredOutput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/output-panel/components/structured-output'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import type { ConsoleEntry } from '@/stores/terminal'

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
 * Reusable toggle button component
 */
const ToggleButton = ({
  isExpanded,
  onClick,
}: {
  isExpanded: boolean
  onClick: (e: React.MouseEvent) => void
}) => (
  <Button variant='ghost' className='!p-1.5 -m-1.5' onClick={onClick} aria-label='Toggle terminal'>
    <ChevronDown
      className={clsx(
        'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
        !isExpanded && 'rotate-180'
      )}
    />
  </Button>
)

/**
 * Props for the OutputPanel component
 */
export interface OutputPanelProps {
  selectedEntry: ConsoleEntry
  outputPanelWidth: number
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
  clearFilters: () => void
  handleClearConsole: (e: React.MouseEvent) => void
  wrapText: boolean
  setWrapText: (wrap: boolean) => void
  openOnRun: boolean
  setOpenOnRun: (open: boolean) => void
  structuredView: boolean
  setStructuredView: (structured: boolean) => void
  outputOptionsOpen: boolean
  setOutputOptionsOpen: (open: boolean) => void
  shouldShowCodeDisplay: boolean
  outputDataStringified: string
  outputData: unknown
  handleClearConsoleFromMenu: () => void
}

/**
 * Output panel component that manages its own search state.
 */
export const OutputPanel = React.memo(function OutputPanel({
  selectedEntry,
  outputPanelWidth,
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
  clearFilters,
  handleClearConsole,
  wrapText,
  setWrapText,
  openOnRun,
  setOpenOnRun,
  structuredView,
  setStructuredView,
  outputOptionsOpen,
  setOutputOptionsOpen,
  shouldShowCodeDisplay,
  outputDataStringified,
  outputData,
  handleClearConsoleFromMenu,
}: OutputPanelProps) {
  const outputContentRef = useRef<HTMLDivElement>(null)
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
              onClick={(e) => {
                e.stopPropagation()
                if (!isExpanded) {
                  expandToLastHeight()
                }
                if (showInput) setShowInput(false)
              }}
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
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isExpanded) {
                    expandToLastHeight()
                  }
                  setShowInput(true)
                }}
                aria-label='Show input'
              >
                Input
              </Button>
            )}
          </div>
          <div className='flex flex-shrink-0 items-center gap-[8px]'>
            {isOutputSearchActive ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={(e) => {
                      e.stopPropagation()
                      closeOutputSearch()
                    }}
                    aria-label='Search in output'
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
                    onClick={(e) => {
                      e.stopPropagation()
                      activateOutputSearch()
                    }}
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
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopy()
                  }}
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
            )}
            {hasActiveFilters && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={(e) => {
                      e.stopPropagation()
                      clearFilters()
                    }}
                    aria-label='Clear filters'
                    className='!p-1.5 -m-1.5'
                  >
                    <FilterX className='h-3 w-3' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>Clear filters</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {filteredEntries.length > 0 && (
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
            )}
            <Popover open={outputOptionsOpen} onOpenChange={setOutputOptionsOpen} size='sm'>
              <PopoverTrigger asChild>
                <Button
                  variant='ghost'
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
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
                  onClick={(e) => {
                    e.stopPropagation()
                    setStructuredView(!structuredView)
                  }}
                >
                  <span>Structured view</span>
                </PopoverItem>
                <PopoverItem
                  active={wrapText}
                  showCheck={wrapText}
                  onClick={(e) => {
                    e.stopPropagation()
                    setWrapText(!wrapText)
                  }}
                >
                  <span>Wrap text</span>
                </PopoverItem>
                <PopoverItem
                  active={openOnRun}
                  showCheck={openOnRun}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenOnRun(!openOnRun)
                  }}
                >
                  <span>Open on run</span>
                </PopoverItem>
              </PopoverContent>
            </Popover>
            <ToggleButton
              isExpanded={isExpanded}
              onClick={(e) => {
                e.stopPropagation()
                handleHeaderClick()
              }}
            />
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
              searchQuery={isOutputSearchActive ? outputSearchQuery : undefined}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
              contentRef={outputContentRef}
            />
          ) : structuredView ? (
            <StructuredOutput
              data={outputData}
              wrapText={wrapText}
              isError={!showInput && Boolean(selectedEntry.error)}
              className='min-h-full'
              searchQuery={isOutputSearchActive ? outputSearchQuery : undefined}
              currentMatchIndex={currentMatchIndex}
              onMatchCountChange={handleMatchCountChange}
              contentRef={outputContentRef}
            />
          ) : (
            <OutputCodeContent
              code={outputDataStringified}
              language='json'
              wrapText={wrapText}
              searchQuery={isOutputSearchActive ? outputSearchQuery : undefined}
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
        onToggleStructuredView={() => setStructuredView(!structuredView)}
        wrapText={wrapText}
        onToggleWrap={() => setWrapText(!wrapText)}
        openOnRun={openOnRun}
        onToggleOpenOnRun={() => setOpenOnRun(!openOnRun)}
        onClearConsole={handleClearConsoleFromMenu}
        hasSelection={hasSelection}
      />
    </>
  )
})
