'use client'

import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditorTypes } from 'monaco-editor'
import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'
import { useAutosave } from '@/hooks/use-autosave'
import { EditorContextMenu } from './editor-context-menu'
import type { PreviewMode } from './file-viewer'
import { PreviewPanel, resolvePreviewType } from './preview-panel'
import {
  INITIAL_TEXT_EDITOR_CONTENT_STATE,
  type StreamingMode,
  type SyncTextEditorContentStateOptions,
  textEditorContentReducer,
} from './text-editor-state'

const SIM_DARK_RULES: MonacoEditorTypes.ITokenThemeRule[] = [
  { token: 'comment', foreground: '606060', fontStyle: 'italic' },
  { token: 'string', foreground: '3ab872' },
  { token: 'string.escape', foreground: '3ab872' },
  { token: 'string.link', foreground: '33b4ff' },
  { token: 'number', foreground: 'e8a87c' },
  { token: 'number.float', foreground: 'e8a87c' },
  { token: 'number.hex', foreground: 'e8a87c' },
  { token: 'keyword', foreground: '33b4ff' },
  { token: 'keyword.control', foreground: '33b4ff' },
  { token: 'storage', foreground: '33b4ff' },
  { token: 'type', foreground: '8fc7f5' },
  { token: 'type.identifier', foreground: '8fc7f5' },
  { token: 'regexp', foreground: 'ff8a65' },
  { token: 'annotation', foreground: 'ffca28' },
  { token: 'delimiter', foreground: '555555' },
  { token: 'tag', foreground: '33b4ff' },
  { token: 'attribute.name', foreground: '8fc7f5' },
  { token: 'attribute.value', foreground: '3ab872' },
  { token: 'strong', foreground: 'e6e6e6', fontStyle: 'bold' },
  { token: 'emphasis', foreground: 'c8c8c8', fontStyle: 'italic' },
  { token: 'variable', foreground: '3ab872' },
  { token: 'variable.source', foreground: 'b0b0b0' },
  { token: 'meta.separator', foreground: '404040' },
]

const SIM_LIGHT_RULES: MonacoEditorTypes.ITokenThemeRule[] = [
  { token: 'comment', foreground: '888888', fontStyle: 'italic' },
  { token: 'string', foreground: '16825d' },
  { token: 'string.escape', foreground: '16825d' },
  { token: 'string.link', foreground: '0078d4' },
  { token: 'number', foreground: 'a85500' },
  { token: 'number.float', foreground: 'a85500' },
  { token: 'number.hex', foreground: 'a85500' },
  { token: 'keyword', foreground: '0078d4' },
  { token: 'keyword.control', foreground: '0078d4' },
  { token: 'storage', foreground: '0078d4' },
  { token: 'type', foreground: '7c4dcc' },
  { token: 'type.identifier', foreground: '7c4dcc' },
  { token: 'regexp', foreground: 'd7390c' },
  { token: 'annotation', foreground: 'e67700' },
  { token: 'delimiter', foreground: 'aaaaaa' },
  { token: 'tag', foreground: '0078d4' },
  { token: 'attribute.name', foreground: '7c4dcc' },
  { token: 'attribute.value', foreground: '16825d' },
  { token: 'strong', foreground: '1a1a1a', fontStyle: 'bold' },
  { token: 'emphasis', foreground: '444444', fontStyle: 'italic' },
  { token: 'variable', foreground: '16825d' },
  { token: 'variable.source', foreground: '555555' },
  { token: 'meta.separator', foreground: 'cccccc' },
]

const MonacoEditor = dynamic(
  async () => {
    const [{ default: Editor, loader }, monaco] = await Promise.all([
      import('@monaco-editor/react'),
      import('monaco-editor'),
    ])

    if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
      window.MonacoEnvironment = {
        getWorker(_: string, label: string) {
          if (label === 'json') {
            return new Worker(
              new URL('monaco-editor/esm/vs/language/json/json.worker', import.meta.url)
            )
          }
          if (label === 'css' || label === 'scss' || label === 'less') {
            return new Worker(
              new URL('monaco-editor/esm/vs/language/css/css.worker', import.meta.url)
            )
          }
          if (label === 'html' || label === 'handlebars' || label === 'razor') {
            return new Worker(
              new URL('monaco-editor/esm/vs/language/html/html.worker', import.meta.url)
            )
          }
          if (label === 'typescript' || label === 'javascript') {
            return new Worker(
              new URL('monaco-editor/esm/vs/language/typescript/ts.worker', import.meta.url)
            )
          }
          return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url))
        },
      }
    }

    loader.config({ monaco })

    monaco.editor.defineTheme('sim-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: SIM_DARK_RULES,
      colors: {
        'editor.background': '#1b1b1b',
        'editor.foreground': '#e6e6e6',
        'editorLineNumber.foreground': '#404040',
        'editorLineNumber.activeForeground': '#787878',
        'editor.selectionBackground': '#33b4ff28',
        'editor.inactiveSelectionBackground': '#33b4ff14',
        'editor.lineHighlightBackground': '#23232380',
        'editor.lineHighlightBorder': '#00000000',
        'editorGutter.background': '#1b1b1b',
        'editorWidget.background': '#242424',
        'editorWidget.border': '#333333',
        'editorWidget.foreground': '#e6e6e6',
        'editor.findMatchBackground': '#33b4ff40',
        'editor.findMatchHighlightBackground': '#33b4ff1a',
        'editor.findMatchBorder': '#33b4ff',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#33333380',
        'scrollbarSlider.hoverBackground': '#45454580',
        'scrollbarSlider.activeBackground': '#505050',
        'editorBracketMatch.background': '#33b4ff1a',
        'editorBracketMatch.border': '#33b4ff80',
        'editorIndentGuide.background1': '#2a2a2a',
        'editorIndentGuide.activeBackground1': '#454545',
        'editorCursor.foreground': '#e6e6e6',
        'editor.wordHighlightBackground': '#33b4ff14',
        'editor.wordHighlightBorder': '#33b4ff40',
        'editorSuggestWidget.background': '#242424',
        'editorSuggestWidget.border': '#333333',
        'editorSuggestWidget.foreground': '#e6e6e6',
        'editorSuggestWidget.selectedBackground': '#292929',
        'editorSuggestWidget.selectedForeground': '#e6e6e6',
        'editorHoverWidget.background': '#242424',
        'editorHoverWidget.border': '#333333',
        'editorHoverWidget.foreground': '#e6e6e6',
        'minimap.background': '#1b1b1b',
        'minimapSlider.background': '#33333380',
        focusBorder: '#33b4ff80',
        'input.background': '#242424',
        'input.border': '#333333',
        'input.foreground': '#e6e6e6',
        'inputOption.activeBorder': '#33b4ff',
      },
    })

    monaco.editor.defineTheme('sim-light', {
      base: 'vs',
      inherit: true,
      rules: SIM_LIGHT_RULES,
      colors: {
        'editor.background': '#fefefe',
        'editor.foreground': '#1a1a1a',
        'editorLineNumber.foreground': '#bbbbbb',
        'editorLineNumber.activeForeground': '#707070',
        'editor.selectionBackground': '#0078d430',
        'editor.inactiveSelectionBackground': '#0078d418',
        'editor.lineHighlightBackground': '#f7f7f7',
        'editor.lineHighlightBorder': '#00000000',
        'editorGutter.background': '#fefefe',
        'editorWidget.background': '#ffffff',
        'editorWidget.border': '#dedede',
        'editorWidget.foreground': '#1a1a1a',
        'editor.findMatchBackground': '#0078d428',
        'editor.findMatchHighlightBackground': '#0078d414',
        'editor.findMatchBorder': '#0078d4',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#dedede80',
        'scrollbarSlider.hoverBackground': '#cccccc',
        'scrollbarSlider.activeBackground': '#b0b0b0',
        'editorBracketMatch.background': '#0078d418',
        'editorBracketMatch.border': '#0078d480',
        'editorIndentGuide.background1': '#f0f0f0',
        'editorIndentGuide.activeBackground1': '#d8d8d8',
        'editorCursor.foreground': '#1a1a1a',
        'editor.wordHighlightBackground': '#0078d414',
        'editor.wordHighlightBorder': '#0078d450',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.border': '#dedede',
        'editorSuggestWidget.foreground': '#1a1a1a',
        'editorSuggestWidget.selectedBackground': '#f5f5f5',
        'editorSuggestWidget.selectedForeground': '#1a1a1a',
        'editorHoverWidget.background': '#ffffff',
        'editorHoverWidget.border': '#dedede',
        'editorHoverWidget.foreground': '#1a1a1a',
        'minimap.background': '#fefefe',
        'minimapSlider.background': '#dedede80',
        focusBorder: '#0078d480',
        'input.background': '#ffffff',
        'input.border': '#dedede',
        'input.foreground': '#1a1a1a',
        'inputOption.activeBorder': '#0078d4',
      },
    })

    return Editor
  },
  { ssr: false }
)

const SPLIT_MIN_PCT = 20
const SPLIT_MAX_PCT = 80
const SPLIT_DEFAULT_PCT = 50

/**
 * Monaco's find-widget button hover tooltips render above the button by default. Because the find
 * widget sits at the very top of the editor, the tooltip overlaps the button itself —
 * `document.elementFromPoint` at the button's center returns `.hover-contents` instead of the
 * button, which fires `mouseleave` on the button. Monaco then disposes the tooltip, the cursor
 * lands back on the button, and the cycle repeats every ~210ms, making the buttons unclickable.
 *
 * Translate the tooltip's `.context-view` below the button so the cursor stays on the button
 * while the tooltip is shown, and flip the carat to point up at the button.
 */
const FIND_TOOLTIP_FIX_CSS = `
[data-find-tooltip-fix] .context-view.top.left {
  transform: translateY(56px);
}
[data-find-tooltip-fix] .context-view.top.left .workbench-hover-pointer.bottom {
  top: -3px;
  bottom: auto;
  transform: rotate(225deg);
}
`

/** Maps file extensions to Monaco editor language IDs. */
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
  jsonl: 'json',
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
  const ext = getFileExtension(file.name)
  return MONACO_LANGUAGE_BY_EXTENSION[ext] ?? MONACO_LANGUAGE_BY_MIME[file.type] ?? 'plaintext'
}

function useTextEditorContentState(options: SyncTextEditorContentStateOptions) {
  const [state, dispatch] = useReducer(textEditorContentReducer, INITIAL_TEXT_EDITOR_CONTENT_STATE)

  const prevOptionsRef = useRef<SyncTextEditorContentStateOptions | null>(null)
  const prev = prevOptionsRef.current
  if (
    prev === null ||
    prev.canReconcileToFetchedContent !== options.canReconcileToFetchedContent ||
    prev.fetchedContent !== options.fetchedContent ||
    prev.streamingContent !== options.streamingContent ||
    prev.streamingMode !== options.streamingMode
  ) {
    prevOptionsRef.current = options
    dispatch({ type: 'sync-external', ...options })
  }

  const setDraftContent = useCallback((content: string) => {
    dispatch({ type: 'edit', content })
  }, [])

  const markSavedContent = (content: string) => {
    dispatch({ type: 'save-success', content })
  }

  return {
    content: state.content,
    savedContent: state.savedContent,
    isInitialized: state.phase !== 'uninitialized',
    isStreamInteractionLocked: state.phase === 'streaming' || state.phase === 'reconciling',
    setDraftContent,
    markSavedContent,
  }
}

function useMonacoTheme(): string {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'))
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark ? 'sim-dark' : 'sim-light'
}

function toggleMarkdownCheckbox(markdown: string, targetIndex: number, checked: boolean): string {
  let currentIndex = 0
  return markdown.replace(/^(\s*(?:[-*+]|\d+[.)]) +)\[([ xX])\]/gm, (match, prefix: string) => {
    if (currentIndex++ !== targetIndex) return match
    return `${prefix}[${checked ? 'x' : ' '}]`
  })
}

const DOCUMENT_SKELETON = (
  <div className='flex flex-1 flex-col gap-[6px] p-[24px]'>
    <Skeleton className='h-[14px] w-[45%]' />
    <Skeleton className='h-[14px] w-[70%]' />
    <Skeleton className='h-[14px] w-[55%]' />
    <Skeleton className='mt-2 h-[14px] w-[80%]' />
    <Skeleton className='h-[14px] w-[60%]' />
    <Skeleton className='h-[14px] w-[75%]' />
    <Skeleton className='h-[14px] w-[50%]' />
    <Skeleton className='mt-2 h-[14px] w-[65%]' />
    <Skeleton className='h-[14px] w-[40%]' />
  </div>
)

interface TextEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode: PreviewMode
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  streamingMode?: StreamingMode
  disableStreamingAutoScroll: boolean
  previewContextKey?: string
}

export const TextEditor = memo(function TextEditor({
  file,
  workspaceId,
  canEdit,
  previewMode,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
  streamingMode = 'append',
  disableStreamingAutoScroll,
  previewContextKey,
}: TextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const monacoEditorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const lastSyncedContentRef = useRef('')
  const contentRef = useRef('')
  const textareaStuckRef = useRef(false)
  const suppressScrollListenerRef = useRef(false)

  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT_PCT)
  const [isResizing, setIsResizing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    hasSelection: boolean
  } | null>(null)

  const {
    data: fetchedContent,
    isLoading,
    error,
  } = useWorkspaceFileContent(
    workspaceId,
    file.id,
    file.key,
    file.type === 'text/x-pptxgenjs' ||
      file.type === 'text/x-docxjs' ||
      file.type === 'text/x-pdflibjs'
  )

  const updateContent = useUpdateWorkspaceFileContent()
  const updateContentRef = useRef(updateContent)
  updateContentRef.current = updateContent

  const monacoLanguage = resolveMonacoLanguage(file)
  const monacoTheme = useMonacoTheme()

  const onDirtyChangeRef = useRef(onDirtyChange)
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)
  onDirtyChangeRef.current = onDirtyChange
  onSaveStatusChangeRef.current = onSaveStatusChange

  const {
    content,
    savedContent,
    isInitialized,
    isStreamInteractionLocked,
    setDraftContent,
    markSavedContent,
  } = useTextEditorContentState({
    canReconcileToFetchedContent: file.key.length > 0,
    fetchedContent,
    streamingContent,
    streamingMode,
  })
  contentRef.current = content

  useEffect(() => {
    const editor = monacoEditorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const monacoValue = model.getValue()
    if (monacoValue === content) return

    if (isStreamInteractionLocked || monacoValue === lastSyncedContentRef.current) {
      if (isStreamInteractionLocked) {
        const scrollTop = editor.getScrollTop()
        const scrollHeight = editor.getScrollHeight()
        const { height } = editor.getLayoutInfo()
        if (scrollHeight - scrollTop - height < 80) {
          textareaStuckRef.current = true
        }
      }
      suppressScrollListenerRef.current = true
      if (content.startsWith(monacoValue) && monacoValue.length < content.length) {
        const lastLine = model.getLineCount()
        const lastCol = model.getLineMaxColumn(lastLine)
        model.applyEdits([
          {
            range: {
              startLineNumber: lastLine,
              startColumn: lastCol,
              endLineNumber: lastLine,
              endColumn: lastCol,
            },
            text: content.slice(monacoValue.length),
          },
        ])
      } else {
        model.applyEdits([{ range: model.getFullModelRange(), text: content }])
      }
      suppressScrollListenerRef.current = false
      lastSyncedContentRef.current = content
    }
  }, [content, isStreamInteractionLocked])

  useEffect(() => {
    const editor = monacoEditorRef.current
    if (!editor || !isStreamInteractionLocked || disableStreamingAutoScroll) {
      textareaStuckRef.current = false
      return
    }

    const disposable = editor.onDidScrollChange(() => {
      if (suppressScrollListenerRef.current) return
      const scrollTop = editor.getScrollTop()
      const scrollHeight = editor.getScrollHeight()
      const { height } = editor.getLayoutInfo()
      if (scrollHeight - scrollTop - height >= 80) {
        textareaStuckRef.current = false
      }
    })

    return () => {
      disposable.dispose()
    }
  }, [isStreamInteractionLocked, disableStreamingAutoScroll])

  useEffect(() => {
    if (!isStreamInteractionLocked || !textareaStuckRef.current || disableStreamingAutoScroll)
      return
    const editor = monacoEditorRef.current
    if (!editor) return
    const lineCount = editor.getModel()?.getLineCount() ?? 0
    if (lineCount > 0) {
      editor.revealLine(lineCount)
    }
  }, [content, isStreamInteractionLocked, disableStreamingAutoScroll])

  async function onSave() {
    if (content === savedContent) return

    await updateContentRef.current.mutateAsync({
      workspaceId,
      fileId: file.id,
      content,
    })
    markSavedContent(content)
  }

  const { saveStatus, saveImmediately, isDirty } = useAutosave({
    content,
    savedContent,
    onSave,
    enabled: canEdit && isInitialized && !isStreamInteractionLocked,
  })

  useEffect(() => {
    onDirtyChangeRef.current?.(isDirty)
  }, [isDirty])

  useEffect(() => {
    onSaveStatusChangeRef.current?.(saveStatus)
  }, [saveStatus])

  useEffect(() => {
    if (!saveRef) return
    saveRef.current = saveImmediately
    return () => {
      if (saveRef.current === saveImmediately) {
        saveRef.current = null
      }
    }
  }, [saveImmediately, saveRef])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
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
  }, [isResizing])

  const handleCheckboxToggle = useCallback(
    (checkboxIndex: number, checked: boolean) => {
      const toggled = toggleMarkdownCheckbox(content, checkboxIndex, checked)
      if (toggled !== content) {
        setDraftContent(toggled)
        const model = monacoEditorRef.current?.getModel()
        if (model) {
          model.setValue(toggled)
          lastSyncedContentRef.current = toggled
        }
      }
    },
    [content, setDraftContent]
  )

  const handleEditorMount: OnMount = (editor, monaco) => {
    monacoEditorRef.current = editor

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveImmediately()
    })

    const model = editor.getModel()
    const currentContent = contentRef.current
    if (model && currentContent && model.getValue() !== currentContent) {
      model.setValue(currentContent)
      lastSyncedContentRef.current = currentContent
    }

    const contextMenuDisposable = editor.onContextMenu((e) => {
      e.event.preventDefault()
      const sel = editor.getSelection()
      setContextMenu({
        x: e.event.posx,
        y: e.event.posy,
        hasSelection: sel !== null && !sel.isEmpty(),
      })
    })
    editor.onDidDispose(() => contextMenuDisposable.dispose())
  }

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      setDraftContent(value ?? '')
    },
    [setDraftContent]
  )

  const isStreaming = isStreamInteractionLocked
  const isEditorReadOnly = isStreamInteractionLocked || !canEdit

  const previewType = resolvePreviewType(file.type, file.name)
  const isIframeRendered = previewType === 'html' || previewType === 'svg'
  const effectiveMode = isStreaming && isIframeRendered ? 'editor' : previewMode
  const showEditor = effectiveMode !== 'preview'
  const showPreviewPane = effectiveMode !== 'editor'

  if (streamingContent === undefined) {
    if (isLoading) return DOCUMENT_SKELETON

    if (error && !isInitialized) {
      return (
        <div className='flex flex-1 items-center justify-center'>
          <p className='text-[13px] text-[var(--text-muted)]'>Failed to load file content</p>
        </div>
      )
    }
  }

  const closeContextMenu = () => setContextMenu(null)

  return (
    <div ref={containerRef} data-find-tooltip-fix className='relative flex flex-1 overflow-hidden'>
      <style>{FIND_TOOLTIP_FIX_CSS}</style>
      {showEditor && (
        <div
          style={showPreviewPane ? { width: `${splitPct}%`, flexShrink: 0 } : undefined}
          className={cn(
            'min-w-0',
            !showPreviewPane && 'w-full',
            isResizing && 'pointer-events-none'
          )}
        >
          <MonacoEditor
            key={file.id}
            defaultValue={content}
            language={monacoLanguage}
            theme={monacoTheme}
            options={{
              readOnly: isEditorReadOnly,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              fontSize: 13,
              lineNumbers: 'on',
              padding: { top: 24, bottom: 24 },
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
              tabSize: 2,
              automaticLayout: true,
              renderLineHighlight: 'line',
              occurrencesHighlight: 'singleFile',
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              wordBasedSuggestions: 'currentDocument',
              parameterHints: { enabled: false },
              codeLens: false,
              lightbulb: {
                enabled: 'off' as MonacoEditorTypes.ShowLightbulbIconMode,
              },
              inlayHints: { enabled: 'off' },
              contextmenu: false,
              fixedOverflowWidgets: true,
              glyphMargin: false,
              stickyScroll: { enabled: false },
              bracketPairColorization: { enabled: false },
              unicodeHighlight: { ambiguousCharacters: false },
            }}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            className='h-full'
          />
        </div>
      )}
      {showPreviewPane && (
        <>
          {showEditor && (
            <div className='relative shrink-0'>
              <div className='h-full w-px bg-[var(--border)]' />
              <div
                className='-left-[3px] absolute top-0 z-10 h-full w-[6px] cursor-col-resize'
                onMouseDown={() => setIsResizing(true)}
                role='separator'
                aria-orientation='vertical'
                aria-label='Resize split'
              />
              {isResizing && (
                <div className='-translate-x-[0.5px] pointer-events-none absolute top-0 z-20 h-full w-[2px] bg-[var(--selection)]' />
              )}
            </div>
          )}
          <div
            className={cn('min-w-0 flex-1 overflow-hidden', isResizing && 'pointer-events-none')}
          >
            <PreviewPanel
              key={previewContextKey ? `${file.id}:${previewContextKey}` : file.id}
              content={content}
              mimeType={file.type}
              filename={file.name}
              isStreaming={isStreaming}
              disableAutoScroll={disableStreamingAutoScroll}
              onCheckboxToggle={canEdit && !isStreaming ? handleCheckboxToggle : undefined}
            />
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
          onCut={() => {
            monacoEditorRef.current?.focus()
            monacoEditorRef.current?.trigger(
              'contextmenu',
              'editor.action.clipboardCutAction',
              null
            )
            closeContextMenu()
          }}
          onCopy={() => {
            monacoEditorRef.current?.focus()
            monacoEditorRef.current?.trigger(
              'contextmenu',
              'editor.action.clipboardCopyAction',
              null
            )
            closeContextMenu()
          }}
          onCopyAll={() => {
            navigator.clipboard.writeText(monacoEditorRef.current?.getValue() ?? '').catch(() => {})
            closeContextMenu()
          }}
          onPaste={() => {
            monacoEditorRef.current?.focus()
            monacoEditorRef.current?.trigger(
              'contextmenu',
              'editor.action.clipboardPasteAction',
              null
            )
            closeContextMenu()
          }}
          onSelectAll={() => {
            monacoEditorRef.current?.focus()
            monacoEditorRef.current?.trigger('contextmenu', 'editor.action.selectAll', null)
            closeContextMenu()
          }}
          onFind={() => {
            monacoEditorRef.current?.getAction('actions.find')?.run()
            closeContextMenu()
          }}
        />
      )}
    </div>
  )
})
