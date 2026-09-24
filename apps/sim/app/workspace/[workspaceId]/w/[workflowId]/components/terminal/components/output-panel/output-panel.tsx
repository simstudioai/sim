'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Chip,
  Code,
  cn,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@sim/emcn'
import {
  Check,
  Clipboard,
  Download,
  MoreHorizontal,
  Palette,
  Search,
  Trash,
  X,
} from '@sim/emcn/icons'
import Link from 'next/link'
import { AgentStreamThinkingChrome } from '@/components/agent-stream/agent-stream-chrome'
import { CodeSearchOverlay } from '@/app/workspace/[workspaceId]/components/code-search-overlay/code-search-overlay'
import {
  OutputContextMenu,
  StructuredOutput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/output-panel/components'
import { ToggleButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/toggle-button'
import { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
import { useContextMenu } from '@/hooks/use-context-menu'
import type { ConsoleEntry } from '@/stores/terminal'
import { safeConsoleStringify, useTerminalStore } from '@/stores/terminal'

interface OutputCodeContentProps {
  code: string
  language: 'javascript' | 'json' | 'python' | 'bash'
  wrapText: boolean
  searchQuery: string | undefined
  currentMatchIndex: number
  onMatchCountChange: (count: number) => void
  contentRef: React.RefObject<HTMLDivElement | null>
}

function outputCodeLanguage(language: unknown): OutputCodeContentProps['language'] {
  if (language === 'shell') return 'bash'
  if (language === 'python' || language === 'json' || language === 'bash') return language
  return 'javascript'
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
      appearance='flat'
      className='m-0 min-h-full'
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
 * Store-backed settings (wrapText, openOnRun, structuredView)
 * are accessed directly from useTerminalStore to reduce prop drilling.
 */
export interface OutputPanelProps {
  selectedEntry: ConsoleEntry
  handleOutputPanelResizePointerDown: (e: React.PointerEvent<HTMLElement>) => void
  handleHeaderClick: () => void
  isExpanded: boolean
  expandToLastHeight: () => void
  showInput: boolean
  setShowInput: (show: boolean) => void
  hasInputData: boolean
  isPlaygroundEnabled: boolean
  showCopySuccess: boolean
  handleCopy: () => void
  hasEntries: boolean
  handleExportConsole: (e: React.MouseEvent) => void
  handleClearConsole: (e: React.MouseEvent) => void
  shouldShowCodeDisplay: boolean
  outputData: unknown
  handleClearConsoleFromMenu: () => void
}

/**
 * Output panel component that manages its own search state.
 * Accesses store-backed settings directly to reduce prop drilling.
 */
export const OutputPanel = React.memo(function OutputPanel({
  selectedEntry,
  handleOutputPanelResizePointerDown,
  handleHeaderClick,
  isExpanded,
  expandToLastHeight,
  showInput,
  setShowInput,
  hasInputData,
  isPlaygroundEnabled,
  showCopySuccess,
  handleCopy,
  hasEntries,
  handleExportConsole,
  handleClearConsole,
  shouldShowCodeDisplay,
  outputData,
  handleClearConsoleFromMenu,
}: OutputPanelProps) {
  // Access store-backed settings directly to reduce prop drilling
  const wrapText = useTerminalStore((state) => state.wrapText)
  const setWrapText = useTerminalStore((state) => state.setWrapText)
  const openOnRun = useTerminalStore((state) => state.openOnRun)
  const setOpenOnRun = useTerminalStore((state) => state.setOpenOnRun)
  const structuredView = useTerminalStore((state) => state.structuredView)
  const setStructuredView = useTerminalStore((state) => state.setStructuredView)

  const outputContentRef = useRef<HTMLDivElement>(null)
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

  const outputDataStringified = useMemo(() => {
    if (
      structuredView ||
      shouldShowCodeDisplay ||
      outputData === null ||
      outputData === undefined
    ) {
      return ''
    }

    return safeConsoleStringify(outputData)
  }, [outputData, shouldShowCodeDisplay, structuredView])

  return (
    <>
      <div
        className='absolute top-0 right-0 bottom-0 flex flex-col border-[var(--border)] border-l bg-[var(--bg)]'
        style={{ width: 'var(--output-panel-width)' }}
      >
        {/* Horizontal Resize Handle */}
        <div
          className='-ml-1 absolute top-0 bottom-0 left-0 z-20 w-[8px] cursor-ew-resize'
          onPointerDown={handleOutputPanelResizePointerDown}
          role='separator'
          aria-label='Resize output panel'
          aria-orientation='vertical'
        />

        {/* Header */}
        <div
          className='group flex h-[30px] shrink-0 cursor-pointer items-center justify-between bg-[var(--bg)] pr-4 pl-2.5'
          onClick={handleHeaderClick}
        >
          <div className='flex items-center'>
            <Chip
              active={!showInput}
              aria-pressed={!showInput}
              onClick={handleOutputButtonClick}
              aria-label='Show output'
            >
              Output
            </Chip>
            {hasInputData && (
              <Chip
                active={showInput}
                aria-pressed={showInput}
                onClick={handleInputButtonClick}
                aria-label='Show input'
              >
                Input
              </Chip>
            )}
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            {isOutputSearchActive ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={handleCloseSearchClick}
                    aria-label='Close search'
                    iconPadding='md'
                    className='-m-1.5'
                  >
                    <X className='size-[14px]' />
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
                    iconPadding='md'
                    className='-m-1.5'
                  >
                    <Search className='size-[14px]' />
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
                      iconPadding='md'
                      className='-m-1.5'
                    >
                      <Palette className='size-[14px]' />
                    </Button>
                  </Link>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>Component Playground</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )}

            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={handleCopyClick}
                  aria-label='Copy output'
                  iconPadding='md'
                  className='-m-1.5'
                >
                  {showCopySuccess ? (
                    <Check className='size-[14px]' />
                  ) : (
                    <Clipboard className='size-[14px]' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>{showCopySuccess ? 'Copied' : 'Copy output'}</span>
              </Tooltip.Content>
            </Tooltip.Root>
            {hasEntries && (
              <>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={handleExportConsole}
                      aria-label='Export console CSV'
                      iconPadding='md'
                      className='-m-1.5'
                    >
                      <Download className='size-[14px]' />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    <span>Export CSV</span>
                  </Tooltip.Content>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      variant='ghost'
                      onClick={handleClearConsole}
                      aria-label='Clear console'
                      iconPadding='md'
                      className='-m-1.5'
                    >
                      <Trash className='size-[14px]' />
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
                  iconPadding='md'
                  className='-m-1.5'
                >
                  <MoreHorizontal className='size-[14px]' />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side='bottom'
                align='end'
                sideOffset={4}
                collisionPadding={0}
                onClick={(e) => e.stopPropagation()}
                style={{ minWidth: '140px', maxWidth: '160px' }}
                className='gap-0.5'
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
          <CodeSearchOverlay
            appearance='attached'
            className='top-[30px] right-[8px]'
            inputKind='plain'
            inputRef={outputSearchInputRef}
            query={outputSearchQuery}
            onQueryChange={setOutputSearchQuery}
            matchCount={matchCount}
            currentMatchIndex={currentMatchIndex}
            onPrevious={goToPreviousMatch}
            onNext={goToNextMatch}
            onClose={closeOutputSearch}
          />
        )}

        {/* Content */}
        <div
          className={cn('flex-1 overflow-y-auto', !wrapText && 'overflow-x-auto')}
          onContextMenu={handleOutputPanelContextMenu}
        >
          {!showInput && selectedEntry.agentStreamThinking && (
            <div className='border-[var(--border)] border-b px-3 pt-3'>
              <AgentStreamThinkingChrome
                thinking={selectedEntry.agentStreamThinking}
                isStreaming={Boolean(selectedEntry.isRunning && selectedEntry.agentStreamActive)}
              />
            </div>
          )}
          {shouldShowCodeDisplay ? (
            <OutputCodeContent
              code={selectedEntry.input.code}
              language={outputCodeLanguage(selectedEntry.input.language)}
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
