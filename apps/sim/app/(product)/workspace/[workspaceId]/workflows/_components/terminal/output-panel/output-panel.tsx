'use client'

import {
  type MouseEvent,
  memo,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { ControlRow } from '@sim/emcn/button/control-row'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { ActionMenu, type MenuAction, PointActionMenu } from '@sim/emcn/menu/action-menu'
import { FindBar } from '@/components/find-bar/find-bar'
import { ResizeHandle } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/resize-handle/resize-handle'
import { AgentThinking } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/agent-thinking/agent-thinking'
import {
  CodeViewer,
  type CodeViewerLanguage,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/code-viewer/code-viewer'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/output-panel/output-panel.module.css'
import { StructuredOutput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/structured-output/structured-output'
import {
  ToggleButton,
  toggleFromHeader,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/toggle-button/toggle-button'
import {
  type ConsoleEntry,
  safeConsoleStringify,
  useCodeViewerFeatures,
  useTerminalStore,
} from '@/platform/lib/data/workflow-deploy/terminal'

function codeLanguage(language: unknown): CodeViewerLanguage {
  if (language === 'shell') return 'bash'
  if (language === 'python' || language === 'json' || language === 'bash') return language
  return 'javascript'
}

/** A field of a block's input, when its input is an object that carries it. */
function inputField(entry: ConsoleEntry, field: 'code' | 'language'): unknown {
  const input: unknown = entry.input
  if (typeof input !== 'object' || input === null || !(field in input)) return undefined
  return (input as Record<string, unknown>)[field]
}

interface OutputPanelProps {
  panelRef: RefObject<HTMLDivElement | null>
  selectedEntry: ConsoleEntry
  isExpanded: boolean
  isMobile: boolean
  showInput: boolean
  hasInputData: boolean
  hasEntries: boolean
  /** Terminal-wide actions the panel's header repeats while it covers the logs header. */
  terminalActions: readonly MenuAction[]
  /** The clear action's name, with its shortcut for this platform. */
  clearLabel: string
  onShowInput: (show: boolean) => void
  onBackToLogs: () => void
  onToggleExpanded: () => void
  onExpand: () => void
  onExportConsole: () => void
  onClearConsole: () => void
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void
}

/**
 * The selected block's output (or input), beside the logs: Output and Input tabs, search with match
 * stepping, copy, the display preferences, and a context menu over the content.
 */
export const OutputPanel = memo(function OutputPanel({
  panelRef,
  selectedEntry,
  isExpanded,
  isMobile,
  showInput,
  hasInputData,
  hasEntries,
  terminalActions,
  clearLabel,
  onShowInput,
  onBackToLogs,
  onToggleExpanded,
  onExpand,
  onExportConsole,
  onClearConsole,
  onResizeStart,
}: OutputPanelProps) {
  const wrapText = useTerminalStore((state) => state.wrapText)
  const setWrapText = useTerminalStore((state) => state.setWrapText)
  const structuredView = useTerminalStore((state) => state.structuredView)
  const setStructuredView = useTerminalStore((state) => state.setStructuredView)

  const contentRef = useRef<HTMLDivElement>(null)
  const {
    isSearchActive,
    searchQuery,
    setSearchQuery,
    matchCount,
    currentMatchIndex,
    activateSearch,
    closeSearch,
    goToNextMatch,
    goToPreviousMatch,
    handleMatchCountChange,
    searchInputRef,
  } = useCodeViewerFeatures({
    contentRef,
    externalWrapText: wrapText,
    onWrapTextChange: setWrapText,
  })
  const { copied, copy } = useClipboard()
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string } | null>(null)

  const inputSource = showInput ? inputField(selectedEntry, 'code') : undefined
  const code = typeof inputSource === 'string' ? inputSource : null
  const showCode = code !== null && selectedEntry.blockType === 'function'
  const outputData: unknown = showInput
    ? selectedEntry.input
    : selectedEntry.error
      ? selectedEntry.error
      : selectedEntry.output
  const search = isSearchActive ? searchQuery : undefined

  const stringified = useMemo(() => {
    if (structuredView || showCode || outputData === null || outputData === undefined) return ''
    return safeConsoleStringify(outputData)
  }, [outputData, showCode, structuredView])

  const copyAll = useCallback(() => {
    void copy(showCode && code !== null ? code : safeConsoleStringify(outputData))
  }, [copy, showCode, code, outputData])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [menu])

  const options: MenuAction[] = [
    {
      id: 'structured',
      label: 'Structured view',
      checked: structuredView,
      onSelect: () => setStructuredView(!structuredView),
    },
    {
      id: 'wrap',
      label: 'Wrap text',
      checked: wrapText,
      onSelect: () => setWrapText(!wrapText),
    },
    ...terminalActions,
  ]

  const showTab = (input: boolean) => {
    if (!isExpanded) onExpand()
    onShowInput(input)
  }

  return (
    <div ref={panelRef} className={styles.panel}>
      {!isMobile && (
        <ResizeHandle
          edge='inline-start'
          label='Resize output panel'
          onPointerDown={onResizeStart}
        />
      )}
      <div className={styles.header} onClick={toggleFromHeader(onToggleExpanded)}>
        <div className={styles.tabs} role='tablist' aria-label='Block data'>
          {isMobile && (
            <IconButton label='Back to logs' icon='I093' size='compact' onClick={onBackToLogs} />
          )}
          <ControlRow
            label='Output'
            render={
              <button
                type='button'
                role='tab'
                aria-selected={!showInput}
                onClick={() => showTab(false)}
              />
            }
          />
          {hasInputData && (
            <ControlRow
              label='Input'
              render={
                <button
                  type='button'
                  role='tab'
                  aria-selected={showInput}
                  onClick={() => showTab(true)}
                />
              }
            />
          )}
        </div>
        <div className={styles.actions}>
          <IconButton
            label={isSearchActive ? 'Close search' : 'Search in output'}
            icon={isSearchActive ? 'I105' : 'I089'}
            size='compact'
            tooltip
            onClick={isSearchActive ? closeSearch : activateSearch}
          />
          <IconButton
            label={copied ? 'Copied' : 'Copy output'}
            icon={copied ? 'I072' : 'I006'}
            size='compact'
            tooltip
            onClick={copyAll}
          />
          {hasEntries && !isMobile && (
            <>
              <IconButton
                label='Export console CSV'
                icon='I049'
                size='compact'
                tooltip
                onClick={onExportConsole}
              />
              <IconButton
                label={clearLabel}
                icon='trash'
                size='compact'
                tooltip
                onClick={onClearConsole}
              />
            </>
          )}
          <ActionMenu
            label='Terminal options'
            icon='I108'
            triggerSize='compact'
            align='end'
            actions={options}
          />
          <ToggleButton isExpanded={isExpanded} onToggle={onToggleExpanded} />
        </div>
      </div>

      {isSearchActive && (
        <div className={styles.search}>
          <FindBar
            label='Search output'
            query={searchQuery}
            onQueryChange={setSearchQuery}
            inputRef={searchInputRef}
            results={{ index: currentMatchIndex, count: matchCount }}
            onStep={(direction) => (direction === 1 ? goToNextMatch() : goToPreviousMatch())}
            onClose={closeSearch}
          />
        </div>
      )}

      <div
        className={styles.content}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault()
          setMenu({
            x: event.clientX,
            y: event.clientY,
            selection: window.getSelection()?.toString() ?? '',
          })
        }}
      >
        {!showInput && selectedEntry.agentStreamThinking && (
          <AgentThinking
            thinking={selectedEntry.agentStreamThinking}
            isStreaming={Boolean(selectedEntry.isRunning && selectedEntry.agentStreamActive)}
          />
        )}
        {showCode && code !== null ? (
          <CodeViewer
            code={code}
            language={codeLanguage(inputField(selectedEntry, 'language'))}
            wrapText={wrapText}
            searchQuery={search}
            currentMatchIndex={currentMatchIndex}
            onMatchCountChange={handleMatchCountChange}
            contentRef={contentRef}
          />
        ) : structuredView ? (
          <StructuredOutput
            data={outputData}
            wrapText={wrapText}
            isError={!showInput && Boolean(selectedEntry.error)}
            isRunning={!showInput && Boolean(selectedEntry.isRunning)}
            searchQuery={search}
            currentMatchIndex={currentMatchIndex}
            onMatchCountChange={handleMatchCountChange}
            contentRef={contentRef}
          />
        ) : (
          <CodeViewer
            code={stringified}
            language='json'
            wrapText={wrapText}
            searchQuery={search}
            currentMatchIndex={currentMatchIndex}
            onMatchCountChange={handleMatchCountChange}
            contentRef={contentRef}
            collapsible
          />
        )}
      </div>

      <PointActionMenu
        label='Output actions'
        point={menu}
        onClose={() => setMenu(null)}
        actions={() => [
          {
            id: 'copy-selection',
            label: 'Copy selection',
            disabled: !menu?.selection,
            onSelect: () => {
              if (menu?.selection) void copy(menu.selection)
            },
          },
          { id: 'copy-all', label: 'Copy all', onSelect: copyAll },
          { id: 'search', label: 'Search', onSelect: activateSearch },
          {
            id: 'structured',
            label: 'Structured view',
            checked: structuredView,
            separatorBefore: true,
            onSelect: () => setStructuredView(!structuredView),
          },
          {
            id: 'wrap',
            label: 'Wrap text',
            checked: wrapText,
            onSelect: () => setWrapText(!wrapText),
          },
          ...terminalActions,
          {
            id: 'clear',
            label: 'Clear console',
            separatorBefore: true,
            onSelect: onClearConsole,
          },
        ]}
      />
    </div>
  )
})
