'use client'

import {
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { OnMount } from '@monaco-editor/react'
import { ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import type { editor as MonacoEditorTypes } from 'monaco-editor'
import dynamic from 'next/dynamic'
import { FileSaveConflict } from '@/components/file-viewer/file-save-conflict'
import { defineSurfaceTheme, surfaceMonoFont } from '@/components/file-viewer/monaco-theme'
import { PreviewError } from '@/components/file-viewer/preview-shared'
import { resolvePreviewType } from '@/components/file-viewer/preview-type'
import styles from '@/components/file-viewer/text-editor.module.css'
import { assessTextEditorPaste } from '@/components/file-viewer/text-editor-paste'
import type { FileEditingProps, PreviewMode } from '@/components/file-viewer/types'
import { useEditableFileContent } from '@/components/file-viewer/use-editable-file-content'
import { useResolvedTheme } from '@/components/file-viewer/use-resolved-theme'
import { useSelectionCopyBridge } from '@/components/file-viewer/use-selection-copy-bridge'
import { readSeparatorKey } from '@/lib/core/utils/separator-keys'
import {
  buildFileSelectionLabel,
  truncateSelectionText,
} from '@/lib/mothership/chat/selection-context'
import { toast } from '@/lib/toast/sink'
import type { FileDownloadSource } from '@/lib/uploads/client/download'
import { getFileExtension } from '@/lib/uploads/utils/file'
import { isSimPageSource } from '@/lib/workspace-files/page-compile'
import { SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-content-type'
import { useFileViewerStore } from '@/stores/file-viewer/store'
import type { ChatContext } from '@/stores/panel'

const PreviewPanel = dynamic(
  () => import('@/components/file-viewer/preview-panel').then((module) => module.PreviewPanel),
  { ssr: false }
)

type MonacoInstance = Parameters<OnMount>[1]
type MonacoEditor = Parameters<OnMount>[0]

const EDITOR_FONT_SIZE = 13
const EDITOR_PADDING = 24

const TEXT_EDITOR_OPTIONS = {
  largeFileOptimizations: true,
  maxTokenizationLineLength: 20_000,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  fontSize: EDITOR_FONT_SIZE,
  lineNumbers: 'on',
  padding: { top: EDITOR_PADDING, bottom: EDITOR_PADDING },
  tabSize: 2,
  automaticLayout: true,
  renderLineHighlight: 'line',
  occurrencesHighlight: 'singleFile',
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: 'currentDocument',
  parameterHints: { enabled: false },
  codeLens: false,
  lightbulb: { enabled: 'off' as MonacoEditorTypes.ShowLightbulbIconMode },
  inlayHints: { enabled: 'off' },
  contextmenu: false,
  fixedOverflowWidgets: true,
  glyphMargin: false,
  stickyScroll: { enabled: false },
  bracketPairColorization: { enabled: false },
  unicodeHighlight: { ambiguousCharacters: false },
} satisfies MonacoEditorTypes.IStandaloneEditorConstructionOptions

const MonacoEditorView = dynamic(
  async () => {
    const [{ default: Editor, loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor/esm/vs/editor/editor.main.js'),
    ])
    if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker(_: string, label: string) {
          if (label === 'json')
            return new Worker(
              new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url)
            )
          if (label === 'css' || label === 'scss' || label === 'less')
            return new Worker(
              new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url)
            )
          if (label === 'html' || label === 'handlebars' || label === 'razor')
            return new Worker(
              new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url)
            )
          if (label === 'typescript' || label === 'javascript')
            return new Worker(
              new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url)
            )
          return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url))
        },
      }
    }
    loader.config({ monaco })
    return Editor
  },
  { ssr: false }
)

const SPLIT_MIN_PCT = 20
const SPLIT_MAX_PCT = 80
const SPLIT_DEFAULT_PCT = 50
const SPLIT_KEYBOARD_STEP_PCT = 5

const MONACO_LANGUAGE_BY_EXTENSION: Partial<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  json: 'json',
  /** JSON Lines holds a value per line, which Monaco's single-document JSON parser flags. */
  jsonl: 'plaintext',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  mmd: 'markdown',
  dockerfile: 'dockerfile',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  env: 'shell',
  diff: 'diff',
  patch: 'diff',
}

const MONACO_LANGUAGE_BY_MIME: Partial<Record<string, string>> = {
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'text/typescript': 'typescript',
  'application/typescript': 'typescript',
  'text/x-python': 'python',
  'application/json': 'json',
  'text/x-shellscript': 'shell',
  'text/x-sh': 'shell',
  'text/css': 'css',
  'text/html': 'html',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'image/svg+xml': 'xml',
  'text/x-sql': 'sql',
  'application/x-yaml': 'yaml',
  'text/markdown': 'markdown',
  'text/x-mermaid': 'markdown',
  'text/plain': 'plaintext',
}

function resolveMonacoLanguage(file: { type: string; name: string }): string {
  return (
    MONACO_LANGUAGE_BY_EXTENSION[getFileExtension(file.name)] ??
    MONACO_LANGUAGE_BY_MIME[file.type] ??
    'plaintext'
  )
}

interface TextEditorProps extends FileEditingProps {
  previewMode: PreviewMode
  /** Receives why a save was refused. */
  onSaveError?: (error: unknown) => void
}

/** Within this many pixels of the end, streamed content keeps the source scrolled to its last line. */
const STREAM_STICK_THRESHOLD_PX = 80

/**
 * Text and code in Monaco, themed from the surface's tokens, with the rendered preview beside it
 * (split, with a draggable and keyboard-resizable divider) or instead of it. Autosaves, recovers
 * an unsaved draft, and pauses on a conflicting save.
 */
export function TextEditor({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  onSaveError,
  saveRef,
  downloadSourceRef,
  discardRef,
  onAddToChat,
  streamingContent,
  isAgentEditing,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor | null>(null)
  const monacoRef = useRef<MonacoInstance | null>(null)
  const lastEditorValueRef = useRef('')
  const autoFocusedRef = useRef(false)
  const contentRef = useRef('')
  const stuckToEndRef = useRef(false)
  const suppressScrollListenerRef = useRef(false)
  const [mountedEditor, setMountedEditor] = useState<MonacoEditor | null>(null)
  const sourcePaneId = useId()
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT_PCT)
  const [resizing, setResizing] = useState(false)
  const theme = useResolvedTheme()

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
        : { fileId: file.id, workspaceId, getContent: () => contentRef.current },
    [file.id, workspaceId, isContentLoading, hasContentError]
  )

  const buildSelectionContext = useCallback((): ChatContext | null => {
    const editor = editorRef.current
    const selection = editor?.getSelection()
    const model = editor?.getModel()
    if (!editor || !selection || selection.isEmpty() || !model) return null
    const text = model.getValueInRange(selection)
    if (!text.trim()) return null
    const startLine = selection.startLineNumber
    /** A whole-line selection ends at column 1 of the next line, which holds none of it. */
    const endLine =
      selection.endColumn === 1 && selection.endLineNumber > startLine
        ? selection.endLineNumber - 1
        : selection.endLineNumber
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

  useSelectionCopyBridge(containerRef, buildSelectionContext, workspaceId, !isContentLoading)

  /**
   * Content that changed outside the editor (a reload, a recovered draft, an agent's stream) is
   * applied as an edit. A stream that arrives while the reader is at the end keeps them there.
   */
  useEffect(() => {
    if (lastEditorValueRef.current === content) return
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    const current = model.getValue()
    lastEditorValueRef.current = current
    if (current === content) return
    if (
      isStreamInteractionLocked &&
      editor.getScrollHeight() - editor.getScrollTop() - editor.getLayoutInfo().height <
        STREAM_STICK_THRESHOLD_PX
    )
      stuckToEndRef.current = true
    suppressScrollListenerRef.current = true
    if (content.startsWith(current) && current.length < content.length) {
      const line = model.getLineCount()
      const column = model.getLineMaxColumn(line)
      model.applyEdits([
        {
          range: {
            startLineNumber: line,
            startColumn: column,
            endLineNumber: line,
            endColumn: column,
          },
          text: content.slice(current.length),
        },
      ])
    } else {
      model.applyEdits([{ range: model.getFullModelRange(), text: content }])
    }
    suppressScrollListenerRef.current = false
    lastEditorValueRef.current = content
  }, [content, isStreamInteractionLocked])

  /** Scrolling away from the end while a stream arrives stops following it. */
  useEffect(() => {
    if (!mountedEditor || !isStreamInteractionLocked || disableStreamingAutoScroll) {
      stuckToEndRef.current = false
      return
    }
    const subscription = mountedEditor.onDidScrollChange(() => {
      if (suppressScrollListenerRef.current) return
      const distance =
        mountedEditor.getScrollHeight() -
        mountedEditor.getScrollTop() -
        mountedEditor.getLayoutInfo().height
      if (distance >= STREAM_STICK_THRESHOLD_PX) stuckToEndRef.current = false
    })
    return () => subscription.dispose()
  }, [mountedEditor, isStreamInteractionLocked, disableStreamingAutoScroll])

  useEffect(() => {
    if (!isStreamInteractionLocked || !stuckToEndRef.current || disableStreamingAutoScroll) return
    const editor = editorRef.current
    const lineCount = editor?.getModel()?.getLineCount() ?? 0
    if (editor && lineCount > 0) editor.revealLine(lineCount)
  }, [content, isStreamInteractionLocked, disableStreamingAutoScroll])

  /** The theme follows the surface: the tokens are read again whenever it changes. */
  useEffect(() => {
    const monaco = monacoRef.current
    const host = containerRef.current
    if (!monaco || !host) return
    monaco.editor.setTheme(defineSurfaceTheme(monaco, host, theme))
  }, [theme])

  useLayoutEffect(() => {
    const source = sourceRef.current
    if (source) source.style.width = previewMode === 'split' ? `${splitPct}%` : ''
  })

  useEffect(() => {
    if (!resizing) return
    const handleMove = (event: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const rtl = getComputedStyle(container).direction === 'rtl'
      const width = rtl ? rect.right - event.clientX : event.clientX - rect.left
      setSplitPct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, (width / rect.width) * 100)))
    }
    const handleUp = () => setResizing(false)
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing])

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
    const rtl = container !== null && getComputedStyle(container).direction === 'rtl'
    const delta = (key === 'left' ? -1 : 1) * (rtl ? -1 : 1) * SPLIT_KEYBOARD_STEP_PCT
    setSplitPct((current) => Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, current + delta)))
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    setMountedEditor(editor)
    const host = containerRef.current
    if (host) {
      monaco.editor.setTheme(defineSurfaceTheme(monaco, host, theme))
      editor.updateOptions({ fontFamily: surfaceMonoFont(host) })
    }
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void saveImmediately()
    })
    const model = editor.getModel()
    if (model) {
      if (model.getValue() !== contentRef.current) model.setValue(contentRef.current)
      lastEditorValueRef.current = contentRef.current
    }
    if (autoFocus && !autoFocusedRef.current) {
      autoFocusedRef.current = true
      editor.focus()
    }
  }

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? ''
      lastEditorValueRef.current = next
      contentRef.current = next
      setDraftContent(next)
    },
    [setDraftContent]
  )

  const handlePasteCapture = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText) return
    const editor = editorRef.current
    const model = editor?.getModel()
    const selections = editor?.getSelections()
    const currentText = contentRef.current
    const offsets =
      model && selections?.length
        ? selections.map((selection) => ({
            start: model.getOffsetAt({
              lineNumber: selection.startLineNumber,
              column: selection.startColumn,
            }),
            end: model.getOffsetAt({
              lineNumber: selection.endLineNumber,
              column: selection.endColumn,
            }),
          }))
        : [{ start: currentText.length, end: currentText.length }]
    const admission = assessTextEditorPaste({
      pastedText,
      currentText,
      selections: offsets,
      multiCursorPaste: editor?.getRawOptions().multiCursorPaste ?? 'spread',
    })
    if (admission.accepted) return
    event.preventDefault()
    event.stopPropagation()
    toast.warning('Paste would make this file too large to edit', {
      description: `Inline editing supports files up to ${formatPasteLimit(PASTE_LIMITS.TEXT_EDITOR_BYTES)}. Import or replace the file to keep larger content available without loading it into the editor.`,
    })
  }

  const readOnly = isStreamInteractionLocked || !canEdit
  const editorOptions = useMemo(() => ({ ...TEXT_EDITOR_OPTIONS, readOnly }), [readOnly])

  const contextActions = (): readonly MenuAction[] => {
    const editor = editorRef.current
    const selection = editor?.getSelection()
    const hasSelection = Boolean(selection && !selection.isEmpty())
    const run = (action: string) => {
      editor?.focus()
      editor?.trigger('contextmenu', action, null)
    }
    return [
      ...(onAddToChat
        ? [
            {
              id: 'add-to-chat',
              label: 'Add to Chat',
              disabled: !hasSelection,
              onSelect: () => {
                const context = buildSelectionContext()
                if (context) onAddToChat(context)
              },
            },
          ]
        : []),
      ...(readOnly
        ? []
        : [
            {
              id: 'cut',
              label: 'Cut',
              shortcut: '⌘X',
              disabled: !hasSelection,
              separatorBefore: true,
              onSelect: () => run('editor.action.clipboardCutAction'),
            },
          ]),
      {
        id: 'copy',
        label: 'Copy',
        shortcut: '⌘C',
        disabled: !hasSelection,
        separatorBefore: readOnly,
        onSelect: () => run('editor.action.clipboardCopyAction'),
      },
      {
        id: 'copy-all',
        label: 'Copy all',
        onSelect: () =>
          void navigator.clipboard.writeText(editor?.getValue() ?? '').catch(() => {}),
      },
      ...(readOnly
        ? []
        : [
            {
              id: 'paste',
              label: 'Paste',
              shortcut: '⌘V',
              onSelect: () => run('editor.action.clipboardPasteAction'),
            },
          ]),
      {
        id: 'select-all',
        label: 'Select all',
        shortcut: '⌘A',
        separatorBefore: true,
        onSelect: () => run('editor.action.selectAll'),
      },
      {
        id: 'find',
        label: 'Find',
        shortcut: '⌘F',
        onSelect: () => void editor?.getAction('actions.find')?.run(),
      },
    ]
  }

  const previewType = resolvePreviewType(file.type, file.name)
  const iframeRendered = previewType === 'html' || previewType === 'svg'
  /**
   * A Sim page never shows its source: the rendered page is the file's face. Its record type decides
   * at once; content detection covers pages written before that type existed.
   */
  const trimmedContent = content.trimStart()
  /** A streamed page whose frontmatter has not arrived yet counts already, so its header never flashes. */
  const detectedSimPage =
    file.type === SIM_PAGE_CONTENT_TYPE ||
    (previewType === 'html' &&
      (isSimPageSource(content) ||
        (isStreamInteractionLocked && (trimmedContent === '' || trimmedContent.startsWith('-')))))
  const knownPage = useFileViewerStore((state) => state.pageFileIds.has(file.id))
  const rememberPage = useFileViewerStore((state) => state.rememberPage)
  /** Shared only once committed, before another viewer of the file can paint partial page source. */
  useLayoutEffect(() => {
    if (detectedSimPage) rememberPage(file.id)
  }, [detectedSimPage, file.id, rememberPage])
  const simPage = detectedSimPage || knownPage
  const mode = simPage
    ? 'preview'
    : isStreamInteractionLocked && iframeRendered
      ? 'editor'
      : previewMode
  const showEditor = mode !== 'preview'
  const showPreview = mode !== 'editor'

  if (hasContentError)
    return <PreviewError label='file' error={contentError ?? 'Failed to load file content'} />
  if (isContentLoading) return null

  return (
    <div className={styles.editor}>
      {hasConflict && (
        <FileSaveConflict
          isReloading={isReloading}
          reloadLatestContent={reloadLatestContent}
          downloadDraft={downloadDraft}
        />
      )}
      <div ref={containerRef} className={styles.panes} data-resizing={resizing || undefined}>
        {showEditor && (
          <div
            ref={sourceRef}
            id={sourcePaneId}
            className={styles.source}
            data-split={showPreview || undefined}
            data-paste-max-bytes={PASTE_LIMITS.TEXT_EDITOR_BYTES}
            data-paste-projects-text-result='true'
            onPasteCapture={handlePasteCapture}
          >
            <ContextActionMenu label='Editor' actions={contextActions}>
              <div className={styles.monaco}>
                <MonacoEditorView
                  key={file.id}
                  defaultValue={content}
                  language={resolveMonacoLanguage(file)}
                  options={editorOptions}
                  onChange={handleEditorChange}
                  onMount={handleEditorMount}
                />
              </div>
            </ContextActionMenu>
          </div>
        )}
        {showEditor && showPreview && (
          <div
            className={styles.divider}
            onMouseDown={() => setResizing(true)}
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
        )}
        {showPreview && (
          <div className={styles.preview}>
            <PreviewPanel
              key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
              content={content}
              mimeType={file.type}
              filename={file.name}
              workspaceId={workspaceId}
              fileId={file.id}
              fileKey={file.key}
              isStreaming={isStreamInteractionLocked}
            />
          </div>
        )}
      </div>
    </div>
  )
}
