'use client'

import {
  memo,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { getFiletypeFromFileName, type SupportedLanguages } from '@pierre/diffs'
import { cn, toast } from '@sim/emcn'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import { CodeEditor, type CodeEditorHandle } from '@/components/code-editor/code-editor'
import { readSeparatorKey } from '@/lib/core/utils/separator-keys'
import {
  buildFileSelectionLabel,
  truncateSelectionText,
} from '@/lib/mothership/chat/selection-context'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { isSimPageSource } from '@/lib/workspace-files/page-compile'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-content-type'
import { EditorContextMenu } from '@/app/workspace/[workspaceId]/files/components/file-viewer/editor-context-menu'
import { FileSaveConflict } from '@/app/workspace/[workspaceId]/files/components/file-viewer/file-save-conflict'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer/file-viewer'
import {
  PreviewPanel,
  resolvePreviewType,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-panel'
import { PreviewLoadingFrame } from '@/app/workspace/[workspaceId]/files/components/file-viewer/preview-shared'
import { assessTextEditorPaste } from '@/app/workspace/[workspaceId]/files/components/file-viewer/text-editor-paste'
import { useEditableFileContent } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-editable-file-content'
import { useSelectionCopyBridge } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-selection-copy-bridge'
import { useAddToChat } from '@/hooks/use-add-to-chat'
import { useFileViewerStore } from '@/stores/file-viewer/store'
import type { ChatContext } from '@/stores/panel'

const SPLIT_MIN_PCT = 20
const SPLIT_MAX_PCT = 80
const SPLIT_DEFAULT_PCT = 50
const SPLIT_KEYBOARD_STEP_PCT = 5

/**
 * Syntax for a file whose name does not give it away, by MIME type. A name with a known
 * extension wins; the editor infers that itself.
 */
const LANGUAGE_BY_MIME: Partial<Record<string, SupportedLanguages>> = {
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'text/typescript': 'typescript',
  'application/typescript': 'typescript',
  'text/x-python': 'python',
  'application/json': 'json',
  'text/x-shellscript': 'bash',
  'text/x-sh': 'bash',
  'text/css': 'css',
  'text/html': 'html',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'image/svg+xml': 'xml',
  'text/x-sql': 'sql',
  'application/x-yaml': 'yaml',
  'text/markdown': 'markdown',
  'text/x-mermaid': 'markdown',
}

function languageOverride(file: { type: string; name: string }): SupportedLanguages | undefined {
  return getFiletypeFromFileName(file.name) === 'text' ? LANGUAGE_BY_MIME[file.type] : undefined
}

function isSaveShortcut(event: ReactKeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's'
}

interface TextEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (
    status: 'idle' | 'saving' | 'saved' | 'error',
    retry?: () => Promise<void>
  ) => void
  onSaveError?: (error: unknown) => void
  preview?: ReactNode
  sourceSide?: 'start' | 'end'
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  downloadSourceRef?: React.MutableRefObject<FileDownloadSource | null>
  discardRef?: React.MutableRefObject<(() => void) | null>
  streamingContent?: string
  isAgentEditing?: boolean
  disableStreamingAutoScroll: boolean
  previewContextKey?: string
}

export const TextEditor = memo(function TextEditor({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  onSaveError,
  preview,
  sourceSide = 'start',
  saveRef,
  downloadSourceRef,
  discardRef,
  streamingContent,
  isAgentEditing,
  disableStreamingAutoScroll,
  previewContextKey,
}: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<CodeEditorHandle>(null)
  const contentRef = useRef('')

  const sourcePaneId = useId()
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT_PCT)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    hasSelection: boolean
  } | null>(null)

  const addToChat = useAddToChat()

  const buildSelectionContext = useCallback((): ChatContext | null => {
    const selection = editorRef.current?.getSelection()
    if (!selection?.text.trim()) return null
    const { text, startLine, endLine } = selection
    return {
      kind: 'file_selection',
      fileId: file.id,
      fileName: file.name,
      label: buildFileSelectionLabel(file.name, startLine, endLine),
      text: truncateSelectionText(text),
      startLine,
      endLine,
    }
  }, [file.id, file.name])

  const handleAddSelectionToChat = () => {
    const context = buildSelectionContext()
    if (context) addToChat(context)
  }

  const {
    content,
    setDraftContent,
    isStreamInteractionLocked,
    isContentLoading,
    hasContentError,
    contentError,
    saveImmediately,
    hasConflict,
    isReloading,
    reloadLatestContent,
    downloadDraft,
  } = useEditableFileContent({
    file,
    workspaceId,
    canEdit,
    streamingContent,
    isAgentEditing,
    onDirtyChange,
    onSaveStatusChange,
    onSaveError,
    saveRef,
    discardRef,
  })
  useLayoutEffect(() => {
    contentRef.current = content
  }, [content])

  useImperativeHandle<FileDownloadSource | null, FileDownloadSource | null>(
    downloadSourceRef,
    () =>
      isContentLoading || hasContentError
        ? null
        : {
            fileId: file.id,
            workspaceId,
            getContent: () => contentRef.current,
          },
    [file.id, workspaceId, isContentLoading, hasContentError]
  )

  // Enable once content has loaded — the container (and the editor) only mount after
  // the `isContentLoading` early return below, so the bridge must (re-)attach then.
  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId, !isContentLoading)

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const isRtl = getComputedStyle(container).direction === 'rtl'
      const fromRight = isRtl !== (sourceSide === 'end')
      const sourceWidth = fromRight ? rect.right - e.clientX : e.clientX - rect.left
      const pct = (sourceWidth / rect.width) * 100
      setSplitPct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)))
    }

    const handleMouseUp = () => setIsResizing(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, sourceSide])

  const handleSplitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = readSeparatorKey(event)
    if (!key) return
    event.preventDefault()
    event.stopPropagation()
    if (key === 'min' || key === 'max') {
      setSplitPct(key === 'min' ? SPLIT_MIN_PCT : SPLIT_MAX_PCT)
      return
    }
    const container = containerRef.current
    const isRtl = container !== null && getComputedStyle(container).direction === 'rtl'
    const fromRight = isRtl !== (sourceSide === 'end')
    const delta = (key === 'left' ? -1 : 1) * (fromRight ? -1 : 1) * SPLIT_KEYBOARD_STEP_PCT
    setSplitPct((current) => Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, current + delta)))
  }

  const handleEditorChange = useCallback(
    (value: string) => {
      contentRef.current = value
      setDraftContent(value)
    },
    [setDraftContent]
  )

  const handleSourceKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSaveShortcut(event)) return
    event.preventDefault()
    saveImmediately()
  }

  const handleSourceContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      hasSelection: editorRef.current?.getSelection() != null,
    })
  }

  /** Whether pasting `pastedText` over the selections keeps the file within the editable size; warns when not. */
  const admitsPaste = (pastedText: string): boolean => {
    /* The editor pastes the whole text into every selection, never spreading it across them. */
    const admission = assessTextEditorPaste({
      pastedText,
      currentText: contentRef.current,
      selections: editorRef.current?.getSelectionRanges() ?? [],
      multiCursorPaste: 'full',
    })
    if (admission.accepted) return true
    toast.warning('Paste would make this file too large to edit', {
      description: `Inline editing supports files up to ${formatPasteLimit(PASTE_LIMITS.TEXT_EDITOR_BYTES)}. Import or replace the file to keep larger content available without loading it into the editor.`,
    })
    return false
  }

  /**
   * Runs the menu's Cut or Copy as the native command on the focused editor, as ⌘X and ⌘C do:
   * the editor's own handler copies every selection and cuts in one step, and the copy carries
   * the chat selection reference.
   */
  const runClipboardCommand = (command: 'cut' | 'copy') => {
    editorRef.current?.focus()
    document.execCommand(command)
  }

  const handleEditorPasteCapture = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText || admitsPaste(pastedText)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const isStreaming = isStreamInteractionLocked
  const isEditorReadOnly = isStreamInteractionLocked || !canEdit

  const previewType = resolvePreviewType(file.type, file.name)
  const isIframeRendered = previewType === 'html' || previewType === 'svg'
  // A Sim page NEVER shows its source here — the pdf model: the rendered
  // document is the file's face on every surface, at every moment. The
  // record's internal type decides instantly (stamped at write, known before
  // content loads); content detection is the fallback for files written
  // before the stamp existed. During the very first streamed chunk even the
  // frontmatter is partial, so an html stream that has not yet contradicted
  // the page shape (empty, or an opening '---') already counts — that kills
  // the raw-header flash at stream start and the raw flips between an
  // agent's tool calls. Bespoke raw HTML keeps the old behavior.
  const trimmedContent = content.trimStart()
  const detectedSimPage =
    file.type === SIM_PAGE_CONTENT_TYPE ||
    (previewType === 'html' &&
      (isSimPageSource(content) ||
        (isStreaming && (trimmedContent === '' || trimmedContent.startsWith('-')))))
  const knownPage = useFileViewerStore((state) => state.pageFileIds.has(file.id))
  const rememberPage = useFileViewerStore((state) => state.rememberPage)
  /** Share only committed observations, before another viewer can paint partial page source. */
  useLayoutEffect(() => {
    if (detectedSimPage) rememberPage(file.id)
  }, [detectedSimPage, file.id, rememberPage])
  const isSimPageFile = detectedSimPage || knownPage
  const effectiveMode = isSimPageFile
    ? 'preview'
    : isStreaming && isIframeRendered
      ? 'editor'
      : previewMode
  const showEditor = effectiveMode !== 'preview'
  const showPreviewPane = effectiveMode !== 'editor'

  if (isContentLoading) return <PreviewLoadingFrame className='flex flex-1 flex-col' />

  if (hasContentError) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <p className='text-[var(--text-muted)] text-small'>
          {contentError ?? 'Failed to load file content'}
        </p>
      </div>
    )
  }

  const closeContextMenu = () => setContextMenu(null)

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      {hasConflict && (
        <FileSaveConflict
          isReloading={isReloading}
          reloadLatestContent={reloadLatestContent}
          downloadDraft={downloadDraft}
        />
      )}
      <div
        ref={containerRef}
        className={cn(
          'relative flex flex-1 overflow-hidden',
          sourceSide === 'end' && 'flex-row-reverse'
        )}
      >
        {showEditor && (
          <div
            id={sourcePaneId}
            data-paste-max-bytes={PASTE_LIMITS.TEXT_EDITOR_BYTES}
            data-paste-projects-text-result='true'
            onPasteCapture={handleEditorPasteCapture}
            onKeyDownCapture={handleSourceKeyDownCapture}
            onContextMenu={handleSourceContextMenu}
            style={showPreviewPane ? { width: `${splitPct}%`, flexShrink: 0 } : undefined}
            className={cn(
              'min-w-0',
              !showPreviewPane && 'w-full',
              isResizing && 'pointer-events-none'
            )}
          >
            <CodeEditor
              key={file.id}
              ref={editorRef}
              value={content}
              fileName={file.name}
              language={languageOverride(file)}
              readOnly={isEditorReadOnly}
              onChange={handleEditorChange}
              autoFocus={autoFocus}
              followOutput={isStreaming && !disableStreamingAutoScroll}
            />
          </div>
        )}
        {showPreviewPane && (
          <>
            {showEditor && (
              <div className='relative shrink-0'>
                <div className='h-full w-px bg-[var(--border)]' />
                <div
                  className='-left-[3px] absolute top-0 z-10 h-full w-[6px] cursor-col-resize focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--selection)]'
                  onMouseDown={() => setIsResizing(true)}
                  onKeyDown={handleSplitKeyDown}
                  tabIndex={0}
                  role='separator'
                  aria-orientation='vertical'
                  aria-label='Resize split'
                  aria-controls={sourcePaneId}
                  aria-valuemin={SPLIT_MIN_PCT}
                  aria-valuemax={SPLIT_MAX_PCT}
                  aria-valuenow={splitPct}
                  aria-valuetext={`${Math.round(splitPct)}% source, ${Math.round(100 - splitPct)}% preview`}
                />
                {isResizing && (
                  <div className='-translate-x-[0.5px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]' />
                )}
              </div>
            )}
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-col overflow-hidden',
                isResizing && 'pointer-events-none'
              )}
            >
              {preview ?? (
                <PreviewPanel
                  key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
                  content={content}
                  mimeType={file.type}
                  filename={file.name}
                  workspaceId={workspaceId}
                  fileId={file.id}
                  fileKey={file.key}
                  isStreaming={isStreaming}
                />
              )}
            </div>
          </>
        )}
        {contextMenu && (
          <EditorContextMenu
            isOpen
            position={contextMenu}
            onClose={closeContextMenu}
            hasSelection={contextMenu.hasSelection}
            canEdit={!isEditorReadOnly}
            onAddToChat={() => {
              handleAddSelectionToChat()
              closeContextMenu()
            }}
            onCut={() => {
              closeContextMenu()
              runClipboardCommand('cut')
            }}
            onCopy={() => {
              closeContextMenu()
              runClipboardCommand('copy')
            }}
            onCopyAll={() => {
              closeContextMenu()
              navigator.clipboard.writeText(editorRef.current?.getText() ?? '').catch(() => {})
              editorRef.current?.focus()
            }}
            onPaste={() => {
              closeContextMenu()
              navigator.clipboard
                .readText()
                .then((text) => {
                  if (!text || !admitsPaste(text)) return
                  editorRef.current?.replaceSelection(text)
                  editorRef.current?.focus()
                })
                .catch(() => {})
            }}
            onSelectAll={() => {
              editorRef.current?.selectAll()
              editorRef.current?.focus()
              closeContextMenu()
            }}
          />
        )}
      </div>
    </div>
  )
})
