'use client'

import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ZoomIn, ZoomOut } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Button, Skeleton } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { SUPPORTED_CODE_EXTENSIONS } from '@/lib/uploads/utils/validation'
import {
  useUpdateWorkspaceFileContent,
  useWorkspaceFileBinary,
  useWorkspaceFileContent,
} from '@/hooks/queries/workspace-files'
import { useAutosave } from '@/hooks/use-autosave'
import type { DataTableHandle } from './data-table'
import { DataTable } from './data-table'
import type { PdfDocumentSource } from './pdf-viewer'
import { PreviewPanel, resolvePreviewType } from './preview-panel'

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
    return Editor
  },
  { ssr: false }
)

const PdfViewerCore = dynamic(() => import('./pdf-viewer').then((m) => m.PdfViewerCore), {
  ssr: false,
})

const logger = createLogger('FileViewer')

const SPLIT_MIN_PCT = 20
const SPLIT_MAX_PCT = 80
const SPLIT_DEFAULT_PCT = 50

const TEXT_EDITABLE_MIME_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'application/json',
  'application/x-yaml',
  'text/csv',
  'text/html',
  'text/xml',
  'application/xml',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/typescript',
  'application/toml',
  'text/x-python',
  'text/x-sh',
  'text/x-sql',
  'image/svg+xml',
  'text/x-mermaid',
])

const TEXT_EDITABLE_EXTENSIONS = new Set([
  'md',
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'html',
  'htm',
  'svg',
  'mmd',
  ...SUPPORTED_CODE_EXTENSIONS,
])

const IFRAME_PREVIEWABLE_MIME_TYPES = new Set(['application/pdf', 'text/x-pdflibjs'])
const IFRAME_PREVIEWABLE_EXTENSIONS = new Set(['pdf'])

const IMAGE_PREVIEWABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_PREVIEWABLE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

const AUDIO_PREVIEWABLE_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/opus',
  'audio/x-m4a',
])
const AUDIO_PREVIEWABLE_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus'])

const VIDEO_PREVIEWABLE_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
])
const VIDEO_PREVIEWABLE_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

const PPTX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/x-pptxgenjs',
])
const PPTX_PREVIEWABLE_EXTENSIONS = new Set(['pptx'])

const DOCX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/x-docxjs',
])
const DOCX_PREVIEWABLE_EXTENSIONS = new Set(['docx'])

const XLSX_PREVIEWABLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])
const XLSX_PREVIEWABLE_EXTENSIONS = new Set(['xlsx'])

type FileCategory =
  | 'text-editable'
  | 'iframe-previewable'
  | 'image-previewable'
  | 'audio-previewable'
  | 'video-previewable'
  | 'pptx-previewable'
  | 'docx-previewable'
  | 'xlsx-previewable'
  | 'unsupported'

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

function resolveFileCategory(mimeType: string | null, filename: string): FileCategory {
  if (mimeType && TEXT_EDITABLE_MIME_TYPES.has(mimeType)) return 'text-editable'
  if (mimeType && IFRAME_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'iframe-previewable'
  if (mimeType && IMAGE_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'image-previewable'
  if (mimeType && AUDIO_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'audio-previewable'
  if (mimeType && VIDEO_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'video-previewable'
  if (mimeType && DOCX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'docx-previewable'
  if (mimeType && PPTX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'pptx-previewable'
  if (mimeType && XLSX_PREVIEWABLE_MIME_TYPES.has(mimeType)) return 'xlsx-previewable'

  const ext = getFileExtension(filename)
  const nameKey = ext || filename.toLowerCase()
  if (TEXT_EDITABLE_EXTENSIONS.has(nameKey)) return 'text-editable'
  if (IFRAME_PREVIEWABLE_EXTENSIONS.has(ext)) return 'iframe-previewable'
  if (IMAGE_PREVIEWABLE_EXTENSIONS.has(ext)) return 'image-previewable'
  if (AUDIO_PREVIEWABLE_EXTENSIONS.has(ext)) return 'audio-previewable'
  if (VIDEO_PREVIEWABLE_EXTENSIONS.has(ext)) return 'video-previewable'
  if (DOCX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'docx-previewable'
  if (PPTX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'pptx-previewable'
  if (XLSX_PREVIEWABLE_EXTENSIONS.has(ext)) return 'xlsx-previewable'

  return 'unsupported'
}

export function isTextEditable(file: { type: string; name: string }): boolean {
  return resolveFileCategory(file.type, file.name) === 'text-editable'
}

export function isPreviewable(file: { type: string; name: string }): boolean {
  return resolvePreviewType(file.type, file.name) !== null
}

export type PreviewMode = 'editor' | 'split' | 'preview'
type StreamingMode = 'append' | 'replace'

interface FileViewerProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode?: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  streamingMode?: StreamingMode
  disableStreamingAutoScroll?: boolean
  previewContextKey?: string
}

type TextEditorContentPhase = 'uninitialized' | 'ready' | 'streaming' | 'reconciling'

interface TextEditorContentState {
  phase: TextEditorContentPhase
  content: string
  savedContent: string
  lastStreamedContent: string | null
}

interface SyncTextEditorContentStateOptions {
  canReconcileToFetchedContent: boolean
  fetchedContent?: string
  streamingContent?: string
  streamingMode: StreamingMode
}

type TextEditorContentAction =
  | ({ type: 'sync-external' } & SyncTextEditorContentStateOptions)
  | { type: 'edit'; content: string }
  | { type: 'save-success'; content: string }

const INITIAL_TEXT_EDITOR_CONTENT_STATE: TextEditorContentState = {
  phase: 'uninitialized',
  content: '',
  savedContent: '',
  lastStreamedContent: null,
}

function resolveStreamingEditorContent(
  fetchedContent: string | undefined,
  streamingContent: string,
  streamingMode: StreamingMode
): string {
  if (streamingMode === 'replace' || fetchedContent === undefined) {
    return streamingContent
  }

  if (
    fetchedContent.endsWith(streamingContent) ||
    fetchedContent.endsWith(`\n${streamingContent}`)
  ) {
    return fetchedContent
  }

  return `${fetchedContent}\n${streamingContent}`
}

function finalizeTextEditorContentState(
  state: TextEditorContentState,
  nextContent: string
): TextEditorContentState {
  if (
    state.phase === 'ready' &&
    state.content === nextContent &&
    state.savedContent === nextContent &&
    state.lastStreamedContent === null
  ) {
    return state
  }

  return {
    phase: 'ready',
    content: nextContent,
    savedContent: nextContent,
    lastStreamedContent: null,
  }
}

function moveTextEditorContentStateToStreaming(
  state: TextEditorContentState,
  nextContent: string
): TextEditorContentState {
  if (
    state.phase === 'streaming' &&
    state.content === nextContent &&
    state.lastStreamedContent === nextContent
  ) {
    return state
  }

  return {
    ...state,
    phase: 'streaming',
    content: nextContent,
    lastStreamedContent: nextContent,
  }
}

function moveTextEditorContentStateToReconcile(
  state: TextEditorContentState
): TextEditorContentState {
  if (state.phase === 'reconciling') {
    return state
  }

  return {
    ...state,
    phase: 'reconciling',
  }
}

function syncTextEditorContentState(
  state: TextEditorContentState,
  options: SyncTextEditorContentStateOptions
): TextEditorContentState {
  const { canReconcileToFetchedContent, fetchedContent, streamingContent, streamingMode } = options

  if (streamingContent !== undefined) {
    const nextContent = resolveStreamingEditorContent(
      fetchedContent,
      streamingContent,
      streamingMode
    )
    const fetchedMatchesNextContent = fetchedContent !== undefined && fetchedContent === nextContent
    const fetchedMatchesLastStreamedContent =
      fetchedContent !== undefined &&
      state.lastStreamedContent !== null &&
      fetchedContent === state.lastStreamedContent
    const hasFetchedAdvanced = fetchedContent !== undefined && fetchedContent !== state.savedContent

    if (
      (state.phase === 'streaming' || state.phase === 'reconciling') &&
      (hasFetchedAdvanced || fetchedMatchesLastStreamedContent || fetchedMatchesNextContent)
    ) {
      return finalizeTextEditorContentState(state, fetchedContent)
    }

    if (
      state.phase === 'ready' &&
      state.content === state.savedContent &&
      fetchedMatchesNextContent &&
      fetchedContent !== undefined
    ) {
      return finalizeTextEditorContentState(state, fetchedContent)
    }

    return moveTextEditorContentStateToStreaming(state, nextContent)
  }

  if (state.phase === 'streaming' || state.phase === 'reconciling') {
    if (!canReconcileToFetchedContent) {
      return finalizeTextEditorContentState(state, state.content)
    }

    if (fetchedContent !== undefined) {
      const hasFetchedAdvanced = fetchedContent !== state.savedContent
      const fetchedMatchesLastStreamedContent =
        state.lastStreamedContent !== null && fetchedContent === state.lastStreamedContent

      if (hasFetchedAdvanced || fetchedMatchesLastStreamedContent) {
        return finalizeTextEditorContentState(state, fetchedContent)
      }
    }

    return moveTextEditorContentStateToReconcile(state)
  }

  if (fetchedContent === undefined) {
    return state
  }

  if (state.phase === 'uninitialized') {
    return finalizeTextEditorContentState(state, fetchedContent)
  }

  if (fetchedContent === state.savedContent) {
    return state
  }

  if (state.content === state.savedContent) {
    return finalizeTextEditorContentState(state, fetchedContent)
  }

  return state
}

function textEditorContentReducer(
  state: TextEditorContentState,
  action: TextEditorContentAction
): TextEditorContentState {
  switch (action.type) {
    case 'sync-external':
      return syncTextEditorContentState(state, action)
    case 'edit':
      if (state.phase !== 'ready' || action.content === state.content) {
        return state
      }
      return {
        ...state,
        content: action.content,
      }
    case 'save-success':
      if (
        state.phase === 'ready' &&
        state.content === action.content &&
        state.savedContent === action.content &&
        state.lastStreamedContent === null
      ) {
        return state
      }
      return {
        ...state,
        phase: 'ready',
        content: action.content,
        savedContent: action.content,
        lastStreamedContent: null,
      }
    default:
      return state
  }
}

function useTextEditorContentState(options: SyncTextEditorContentStateOptions) {
  const [state, dispatch] = useReducer(textEditorContentReducer, INITIAL_TEXT_EDITOR_CONTENT_STATE)

  useEffect(() => {
    dispatch({
      type: 'sync-external',
      ...options,
    })
  }, [
    options.canReconcileToFetchedContent,
    options.fetchedContent,
    options.streamingContent,
    options.streamingMode,
  ])

  const setDraftContent = useCallback((content: string) => {
    dispatch({ type: 'edit', content })
  }, [])

  const markSavedContent = useCallback((content: string) => {
    dispatch({ type: 'save-success', content })
  }, [])

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

  return isDark ? 'vs-dark' : 'vs'
}

export function FileViewer({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
  onDirtyChange,
  onSaveStatusChange,
  saveRef,
  streamingContent,
  streamingMode,
  disableStreamingAutoScroll = false,
  previewContextKey,
}: FileViewerProps) {
  const category = resolveFileCategory(file.type, file.name)

  if (category === 'text-editable') {
    return (
      <TextEditor
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        previewMode={previewMode ?? 'editor'}
        autoFocus={autoFocus}
        onDirtyChange={onDirtyChange}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
        streamingContent={streamingContent}
        streamingMode={streamingMode}
        disableStreamingAutoScroll={disableStreamingAutoScroll}
        previewContextKey={previewContextKey}
      />
    )
  }

  if (category === 'iframe-previewable') {
    return (
      <IframePreview file={file} workspaceId={workspaceId} streamingContent={streamingContent} />
    )
  }

  if (category === 'image-previewable') {
    return <ImagePreview key={file.key} file={file} />
  }

  if (category === 'audio-previewable') {
    return <AudioPreview file={file} workspaceId={workspaceId} />
  }

  if (category === 'video-previewable') {
    return <VideoPreview file={file} workspaceId={workspaceId} />
  }

  if (category === 'docx-previewable') {
    return <DocxPreview file={file} workspaceId={workspaceId} streamingContent={streamingContent} />
  }

  if (category === 'pptx-previewable') {
    return <PptxPreview file={file} workspaceId={workspaceId} streamingContent={streamingContent} />
  }

  if (category === 'xlsx-previewable') {
    return (
      <XlsxPreview
        file={file}
        workspaceId={workspaceId}
        canEdit={canEdit}
        onSaveStatusChange={onSaveStatusChange}
        saveRef={saveRef}
      />
    )
  }

  return <UnsupportedPreview file={file} />
}

interface TextEditorProps {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  previewMode: PreviewMode
  autoFocus?: boolean
  onDirtyChange?: (isDirty: boolean) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
  streamingContent?: string
  streamingMode?: StreamingMode
  disableStreamingAutoScroll: boolean
  previewContextKey?: string
}

function TextEditor({
  file,
  workspaceId,
  canEdit,
  previewMode,
  autoFocus,
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
  const hasAutoFocusedRef = useRef(false)
  const contentRef = useRef('')

  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT_PCT)
  const [isResizing, setIsResizing] = useState(false)

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

  // Sync external content (initial load + streaming) to Monaco model
  useEffect(() => {
    const editor = monacoEditorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const monacoValue = model.getValue()
    if (monacoValue === content) return

    // Only override Monaco when we're pushing external content, not user edits:
    // - During streaming/reconciling: always push
    // - On first init (monacoValue matches last synced value): push
    if (isStreamInteractionLocked || monacoValue === lastSyncedContentRef.current) {
      model.setValue(content)
      lastSyncedContentRef.current = content
    }
  }, [content, isStreamInteractionLocked])

  const textareaStuckRef = useRef(true)
  useEffect(() => {
    const editor = monacoEditorRef.current
    if (!editor || !isStreamInteractionLocked || disableStreamingAutoScroll) {
      textareaStuckRef.current = false
      return
    }

    textareaStuckRef.current = true
    const domNode = editor.getDomNode()
    if (!domNode) return

    const scrollable = domNode.querySelector('.monaco-scrollable-element') as HTMLElement | null
    if (!scrollable) return

    const onWheel = (e: Event) => {
      if ((e as WheelEvent).deltaY < 0) textareaStuckRef.current = false
    }
    scrollable.addEventListener('wheel', onWheel, { passive: true })

    return () => {
      scrollable.removeEventListener('wheel', onWheel)
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
        // Also update Monaco synchronously so the user sees the change
        const model = monacoEditorRef.current?.getModel()
        if (model) {
          model.setValue(toggled)
          lastSyncedContentRef.current = toggled
        }
      }
    },
    [content, setDraftContent]
  )

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
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

    if (autoFocus && !hasAutoFocusedRef.current) {
      hasAutoFocusedRef.current = true
      editor.focus()
    }
  }, [])

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

  return (
    <div ref={containerRef} className='relative flex flex-1 overflow-hidden'>
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
              occurrencesHighlight: 'off',
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
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
              onCheckboxToggle={canEdit && !isStreaming ? handleCheckboxToggle : undefined}
            />
          </div>
        </>
      )}
    </div>
  )
}

const PDF_PAGE_SKELETON = (
  <div className='absolute inset-0 flex flex-col items-center gap-4 overflow-y-auto bg-[var(--surface-1)] p-6'>
    {[0, 1].map((i) => (
      <div
        key={i}
        className='w-full max-w-[640px] shrink-0 rounded-md bg-[var(--surface-2)] p-8 shadow-medium'
        style={{ aspectRatio: '1 / 1.414' }}
      >
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-[14px] w-[60%]' />
          <Skeleton className='h-[14px] w-[80%]' />
          <Skeleton className='h-[14px] w-[55%]' />
          <Skeleton className='mt-2 h-[14px] w-[75%]' />
          <Skeleton className='h-[14px] w-[65%]' />
          <Skeleton className='h-[14px] w-[85%]' />
          <Skeleton className='h-[14px] w-[50%]' />
        </div>
      </div>
    ))}
  </div>
)

const IframePreview = memo(function IframePreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const [streamingBuffer, setStreamingBuffer] = useState<ArrayBuffer | null>(null)
  const streamingBufferRef = useRef<ArrayBuffer | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (streamingContent === undefined) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      if (cancelled) return

      try {
        setRendering(true)
        setRenderError(null)

        const response = await fetch(`/api/workspaces/${workspaceId}/pdf/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }

        const buf = await response.arrayBuffer()
        if (cancelled) return

        streamingBufferRef.current = buf
        setStreamingBuffer(buf)
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          const msg = toError(err).message || 'Failed to render PDF'
          if (streamingBufferRef.current || shouldSuppressStreamingDocumentError(msg)) {
            logger.info('Suppressing transient PDF streaming preview error', { error: msg })
          } else {
            logger.error('PDF render failed', { error: msg })
            setRenderError(msg)
          }
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [streamingContent, workspaceId])

  const staticSource = useMemo<PdfDocumentSource>(
    () => ({
      kind: 'url',
      url: `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`,
    }),
    [file.key]
  )

  const streamingSource = useMemo<PdfDocumentSource | null>(
    () => (streamingBuffer ? { kind: 'buffer', buffer: streamingBuffer } : null),
    [streamingBuffer]
  )

  if (renderError) return <PreviewError label='PDF' error={renderError} />

  if (rendering && !streamingBuffer) {
    return <div className='relative flex flex-1 overflow-hidden'>{PDF_PAGE_SKELETON}</div>
  }

  if (streamingContent !== undefined) {
    if (!streamingSource) return null
    return (
      <PdfViewerCore
        key={streamingBuffer!.byteLength}
        source={streamingSource}
        filename={file.name}
      />
    )
  }

  return <PdfViewerCore source={staticSource} filename={file.name} />
})

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_WHEEL_SENSITIVITY = 0.005
const ZOOM_BUTTON_FACTOR = 1.2

const clampZoom = (z: number) => Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX)

const ImagePreview = memo(function ImagePreview({ file }: { file: WorkspaceFileRecord }) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetAtDragStart = useRef({ x: 0, y: 0 })
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  const containerRef = useRef<HTMLDivElement>(null)

  const zoomIn = () => setZoom((z) => clampZoom(z * ZOOM_BUTTON_FACTOR))
  const zoomOut = () => setZoom((z) => clampZoom(z / ZOOM_BUTTON_FACTOR))

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY)))
      } else {
        setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetAtDragStart.current = offsetRef.current
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    e.preventDefault()
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return
    setOffset({
      x: offsetAtDragStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetAtDragStart.current.y + (e.clientY - dragStart.current.y),
    })
  }

  const handleMouseUp = () => {
    isDragging.current = false
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
  }

  return (
    <div
      ref={containerRef}
      className='relative flex flex-1 cursor-grab overflow-hidden bg-[var(--surface-1)]'
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className='pointer-events-none absolute inset-0 flex items-center justify-center'
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <img
          src={serveUrl}
          alt={file.name}
          className='max-h-full max-w-full select-none rounded-md object-contain'
          draggable={false}
          loading='eager'
        />
      </div>
      <div
        className='absolute right-4 bottom-4 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 shadow-card'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Button
          variant='ghost'
          size='sm'
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN}
          className='h-6 w-6 p-0'
          aria-label='Zoom out'
        >
          <ZoomOut className='h-3.5 w-3.5' />
        </Button>
        <span className='min-w-[3rem] text-center text-[11px] text-[var(--text-secondary)]'>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant='ghost'
          size='sm'
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX}
          className='h-6 w-6 p-0'
          aria-label='Zoom in'
        >
          <ZoomIn className='h-3.5 w-3.5' />
        </Button>
      </div>
    </div>
  )
})

const AudioPreview = memo(function AudioPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const {
    data: fileData,
    isLoading,
    error: fetchError,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const replaceBlobUrl = useCallback((nextUrl: string | null) => {
    const previousUrl = blobUrlRef.current
    blobUrlRef.current = nextUrl
    setBlobUrl(nextUrl)
    if (previousUrl && previousUrl !== nextUrl) {
      URL.revokeObjectURL(previousUrl)
    }
  }, [])

  useEffect(() => {
    replaceBlobUrl(null)
  }, [file.id, file.key, replaceBlobUrl])

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!fileData) return
    replaceBlobUrl(URL.createObjectURL(new Blob([fileData], { type: file.type || 'audio/mpeg' })))
  }, [file.type, fileData, replaceBlobUrl])

  const error = blobUrl !== null ? null : resolvePreviewError(fetchError, null)
  if (error) return <PreviewError label='audio' error={error} />

  if (isLoading && !blobUrl) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
        <Skeleton className='h-[40px] w-[40px] rounded-full' />
        <Skeleton className='h-[14px] w-[160px]' />
        <Skeleton className='h-[40px] w-full max-w-[480px] rounded-lg' />
      </div>
    )
  }

  return (
    <div className='flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface-1)] p-8'>
      <div className='flex flex-col items-center gap-2 text-center'>
        <div className='text-[32px]'>🎵</div>
        <p className='font-medium text-[14px] text-[var(--text-primary)]'>{file.name}</p>
      </div>
      {blobUrl && (
        // biome-ignore lint/a11y/useMediaCaption: audio from workspace files
        <audio src={blobUrl} controls className='w-full max-w-[480px]' />
      )}
    </div>
  )
})

const VideoPreview = memo(function VideoPreview({
  file,
  workspaceId,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
}) {
  const {
    data: fileData,
    isLoading,
    error: fetchError,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const replaceBlobUrl = useCallback((nextUrl: string | null) => {
    const previousUrl = blobUrlRef.current
    blobUrlRef.current = nextUrl
    setBlobUrl(nextUrl)
    if (previousUrl && previousUrl !== nextUrl) {
      URL.revokeObjectURL(previousUrl)
    }
  }, [])

  useEffect(() => {
    replaceBlobUrl(null)
  }, [file.id, file.key, replaceBlobUrl])

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!fileData) return
    replaceBlobUrl(URL.createObjectURL(new Blob([fileData], { type: file.type || 'video/mp4' })))
  }, [file.type, fileData, replaceBlobUrl])

  const error = blobUrl !== null ? null : resolvePreviewError(fetchError, null)
  if (error) return <PreviewError label='video' error={error} />

  if (isLoading && !blobUrl) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--surface-1)] p-8'>
        <Skeleton className='w-full max-w-[720px]' style={{ aspectRatio: '16 / 9' }} />
      </div>
    )
  }

  return (
    <div className='flex h-full items-center justify-center bg-black'>
      {blobUrl && (
        // biome-ignore lint/a11y/useMediaCaption: video from workspace files
        <video src={blobUrl} controls className='max-h-full max-w-full' />
      )}
    </div>
  )
})

function resolvePreviewError(fetchError: Error | null, renderError: string | null): string | null {
  if (fetchError) return fetchError.message
  return renderError
}

function shouldSuppressStreamingDocumentError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('preview failed') ||
    lower.includes('aborterror') ||
    lower.includes('unexpected end') ||
    lower.includes('unexpected eof') ||
    lower.includes('invalid or unexpected token') ||
    lower.includes('end of central directory') ||
    lower.includes('corrupted zip') ||
    lower.includes('end of data reached')
  )
}

function PreviewError({ label, error }: { label: string; error: string }) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>Failed to preview {label}</p>
      <p className='text-[13px] text-[var(--text-muted)]'>{error}</p>
    </div>
  )
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

const XLSX_SKELETON = (
  <div className='flex flex-1 flex-col overflow-hidden'>
    <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-1)] px-3 py-2'>
      <Skeleton className='h-[22px] w-[60px] rounded' />
      <Skeleton className='h-[22px] w-[48px] rounded' />
    </div>
    <div className='flex-1 overflow-auto p-6'>
      <div className='overflow-hidden rounded-md border border-[var(--border)]'>
        <div className='flex gap-4 bg-[var(--surface-2)] px-3 py-2'>
          {[1, 1, 1, 1].map((_, i) => (
            <Skeleton key={i} className='h-[12px] flex-1' />
          ))}
        </div>
        {[...Array(7)].map((_, i) => (
          <div key={i} className='flex gap-4 border-[var(--border)] border-t px-3 py-2'>
            {[1, 1, 1, 1].map((_, j) => (
              <Skeleton key={j} className='h-[12px] flex-1' />
            ))}
          </div>
        ))}
      </div>
    </div>
  </div>
)

const PPTX_SLIDE_SKELETON = (
  <div className='flex flex-1 flex-col items-center gap-4 overflow-y-auto bg-[var(--surface-1)] p-6'>
    {[0, 1].map((i) => (
      <div
        key={i}
        className='w-full max-w-[720px] shrink-0 rounded-md bg-[var(--surface-2)] p-8 shadow-medium'
        style={{ aspectRatio: '16 / 9' }}
      >
        <div className='flex h-full flex-col justify-between'>
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-[18px] w-[50%]' />
            <Skeleton className='h-[14px] w-[70%]' />
            <Skeleton className='h-[14px] w-[60%]' />
          </div>
          <div className='flex flex-col gap-2'>
            <Skeleton className='h-[14px] w-[80%]' />
            <Skeleton className='h-[14px] w-[65%]' />
          </div>
        </div>
      </div>
    ))}
  </div>
)

const DocxPreview = memo(function DocxPreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastSuccessfulHtmlRef = useRef('')
  const {
    data: fileData,
    isLoading,
    error: fetchError,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [hasRenderedPreview, setHasRenderedPreview] = useState(false)

  useEffect(() => {
    lastSuccessfulHtmlRef.current = ''
    setRenderError(null)
    setRendering(false)
    setHasRenderedPreview(false)
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }
  }, [file.id, file.key])

  useEffect(() => {
    if (!containerRef.current || !fileData || streamingContent !== undefined) return

    let cancelled = false

    async function render() {
      try {
        setRendering(true)
        const { renderAsync } = await import('docx-preview')
        if (cancelled || !containerRef.current) return
        setRenderError(null)
        containerRef.current.innerHTML = ''
        await renderAsync(fileData, containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        })
        if (!cancelled && containerRef.current) {
          const wrapper = containerRef.current.querySelector<HTMLElement>('.docx-wrapper')
          if (wrapper) wrapper.style.background = 'transparent'
          containerRef.current.querySelectorAll<HTMLElement>('section.docx').forEach((page) => {
            page.style.boxShadow = 'var(--shadow-medium)'
          })
          lastSuccessfulHtmlRef.current = containerRef.current.innerHTML
          setHasRenderedPreview(true)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to render document'
          logger.error('DOCX render failed', { error: msg })
          setRenderError(msg)
        }
      } finally {
        if (!cancelled) {
          setRendering(false)
        }
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [fileData, streamingContent])

  useEffect(() => {
    if (streamingContent === undefined || !containerRef.current) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      const container = containerRef.current
      if (!container || cancelled) return

      const previousHtml = lastSuccessfulHtmlRef.current

      try {
        setRendering(true)
        setRenderError(null)

        const response = await fetch(`/api/workspaces/${workspaceId}/docx/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }

        const arrayBuffer = await response.arrayBuffer()
        if (cancelled || !containerRef.current) return

        const { renderAsync } = await import('docx-preview')
        if (cancelled || !containerRef.current) return

        containerRef.current.innerHTML = ''
        await renderAsync(new Uint8Array(arrayBuffer), containerRef.current, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        })

        if (!cancelled && containerRef.current) {
          const wrapper = containerRef.current.querySelector<HTMLElement>('.docx-wrapper')
          if (wrapper) wrapper.style.background = 'transparent'
          containerRef.current.querySelectorAll<HTMLElement>('section.docx').forEach((page) => {
            page.style.boxShadow = 'var(--shadow-medium)'
          })
          lastSuccessfulHtmlRef.current = containerRef.current.innerHTML
          setHasRenderedPreview(true)
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          if (containerRef.current && previousHtml) {
            containerRef.current.innerHTML = previousHtml
            setHasRenderedPreview(true)
          }
          const msg = toError(err).message || 'Failed to render document'
          if (previousHtml || shouldSuppressStreamingDocumentError(msg)) {
            logger.info('Suppressing transient DOCX streaming preview error', { error: msg })
          } else {
            logger.error('DOCX render failed', { error: msg })
            setRenderError(msg)
          }
        }
      } finally {
        if (!cancelled) {
          setRendering(false)
        }
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [streamingContent, workspaceId])

  const error =
    hasRenderedPreview && streamingContent !== undefined
      ? null
      : streamingContent !== undefined
        ? renderError
        : resolvePreviewError(fetchError, renderError)
  if (error) return <PreviewError label='document' error={error} />
  const showSkeleton =
    !hasRenderedPreview &&
    ((streamingContent !== undefined && rendering) || (streamingContent === undefined && isLoading))

  return (
    <div className='relative h-full w-full overflow-auto bg-[var(--surface-1)]'>
      {showSkeleton && (
        <div className='absolute inset-0 z-10 bg-[var(--surface-1)]'>{PDF_PAGE_SKELETON}</div>
      )}
      <div
        ref={containerRef}
        className={cn('h-full w-full overflow-auto', showSkeleton && 'opacity-0')}
      />
    </div>
  )
})

const pptxSlideCache = new Map<string, string[]>()

function pptxCacheKey(fileId: string, dataUpdatedAt: number, byteLength: number): string {
  return `${fileId}:${dataUpdatedAt}:${byteLength}`
}

function shouldSuppressStreamingPptxError(message: string): boolean {
  return (
    shouldSuppressStreamingDocumentError(message) ||
    message.includes('SyntaxError: Invalid or unexpected token') ||
    message.includes('PPTX generation cancelled') ||
    message.includes('SyntaxError: Unexpected end of input')
  )
}

function pptxCacheSet(key: string, slides: string[]): void {
  pptxSlideCache.set(key, slides)
  if (pptxSlideCache.size > 5) {
    const oldest = pptxSlideCache.keys().next().value
    if (oldest !== undefined) pptxSlideCache.delete(oldest)
  }
}

async function renderPptxSlides(
  data: Uint8Array,
  onSlide: (src: string, index: number) => void,
  cancelled: () => boolean
): Promise<void> {
  const { PPTXViewer } = await import('pptxviewjs')
  if (cancelled()) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const { width, height } = await getPptxRenderSize(data, dpr)
  const W = width
  const H = height

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const viewer = new PPTXViewer({ canvas })
  await viewer.loadFile(data)
  const count = viewer.getSlideCount()
  if (cancelled() || count === 0) return

  for (let i = 0; i < count; i++) {
    if (cancelled()) break
    if (i === 0) await viewer.render()
    else await viewer.goToSlide(i)
    onSlide(canvas.toDataURL('image/jpeg', 0.85), i)
  }
}

async function getPptxRenderSize(
  data: Uint8Array,
  dpr: number
): Promise<{ width: number; height: number }> {
  const fallback = {
    width: Math.round(1920 * dpr),
    height: Math.round(1080 * dpr),
  }

  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(data)
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('text')
    if (!presentationXml) return fallback

    const tagMatch = presentationXml.match(/<p:sldSz\s[^>]+>/)
    if (!tagMatch) return fallback
    const tag = tagMatch[0]
    const cxMatch = tag.match(/\bcx="(\d+)"/)
    const cyMatch = tag.match(/\bcy="(\d+)"/)
    if (!cxMatch || !cyMatch) return fallback

    const cx = Number(cxMatch[1])
    const cy = Number(cyMatch[1])
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return fallback

    const aspectRatio = cx / cy
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return fallback

    const baseLongEdge = 1920 * dpr
    if (aspectRatio >= 1) {
      return {
        width: Math.round(baseLongEdge),
        height: Math.round(baseLongEdge / aspectRatio),
      }
    }

    return {
      width: Math.round(baseLongEdge * aspectRatio),
      height: Math.round(baseLongEdge),
    }
  } catch {
    return fallback
  }
}

function PptxPreview({
  file,
  workspaceId,
  streamingContent,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  streamingContent?: string
}) {
  const {
    data: fileData,
    isLoading: isFetching,
    error: fetchError,
    dataUpdatedAt,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)

  const cacheKey = pptxCacheKey(file.id, dataUpdatedAt, fileData?.byteLength ?? 0)
  const cached = pptxSlideCache.get(cacheKey)

  const [slides, setSlides] = useState<string[]>(cached ?? [])
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (streamingContent === undefined) return

    let cancelled = false
    const controller = new AbortController()

    const debounceTimer = setTimeout(async () => {
      if (cancelled) return
      try {
        setRendering(true)
        setRenderError(null)

        const response = await fetch(`/api/workspaces/${workspaceId}/pptx/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: streamingContent }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Preview failed' }))
          throw new Error(err.error || 'Preview failed')
        }
        if (cancelled) return
        const arrayBuffer = await response.arrayBuffer()
        if (cancelled) return
        const data = new Uint8Array(arrayBuffer)
        const images: string[] = []
        await renderPptxSlides(
          data,
          (src) => {
            images.push(src)
            if (!cancelled) setSlides([...images])
          },
          () => cancelled
        )
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          const msg = toError(err).message || 'Failed to render presentation'
          if (shouldSuppressStreamingPptxError(msg)) {
            logger.info('Suppressing transient PPTX streaming preview error', { error: msg })
          } else {
            logger.error('PPTX render failed', { error: msg })
            setRenderError(msg)
          }
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(debounceTimer)
      controller.abort()
    }
  }, [streamingContent, workspaceId])

  useEffect(() => {
    if (streamingContent !== undefined) return

    let cancelled = false

    async function render() {
      if (cancelled) return
      try {
        if (cached) {
          setSlides(cached)
          return
        }

        if (!fileData) return
        setRendering(true)
        setRenderError(null)
        setSlides([])
        const data = new Uint8Array(fileData)
        const images: string[] = []
        await renderPptxSlides(
          data,
          (src) => {
            images.push(src)
            if (!cancelled) setSlides([...images])
          },
          () => cancelled
        )
        if (!cancelled && images.length > 0) {
          pptxCacheSet(cacheKey, images)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to render presentation'
          logger.error('PPTX render failed', { error: msg })
          setRenderError(msg)
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    render()

    return () => {
      cancelled = true
    }
  }, [fileData, dataUpdatedAt, streamingContent, cacheKey, workspaceId])

  const error = resolvePreviewError(fetchError, renderError)
  const loading = isFetching || rendering

  if (error) return <PreviewError label='presentation' error={error} />

  if (loading && slides.length === 0) {
    return PPTX_SLIDE_SKELETON
  }

  return (
    <div className='flex-1 overflow-y-auto bg-[var(--surface-1)] p-[24px]'>
      <div className='mx-auto flex max-w-[960px] flex-col gap-[16px]'>
        {slides.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Slide ${i + 1}`}
            className='w-full rounded-md shadow-medium'
          />
        ))}
      </div>
    </div>
  )
}

function toggleMarkdownCheckbox(markdown: string, targetIndex: number, checked: boolean): string {
  let currentIndex = 0
  return markdown.replace(/^(\s*(?:[-*+]|\d+[.)]) +)\[([ xX])\]/gm, (match, prefix: string) => {
    if (currentIndex++ !== targetIndex) return match
    return `${prefix}[${checked ? 'x' : ' '}]`
  })
}

const XLSX_MAX_ROWS = 1_000

interface XlsxSheet {
  name: string
  headers: string[]
  rows: string[][]
  truncated: boolean
}

const XlsxPreview = memo(function XlsxPreview({
  file,
  workspaceId,
  canEdit,
  onSaveStatusChange,
  saveRef,
}: {
  file: WorkspaceFileRecord
  workspaceId: string
  canEdit: boolean
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}) {
  const {
    data: fileData,
    isLoading,
    error: fetchError,
  } = useWorkspaceFileBinary(workspaceId, file.id, file.key)

  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [currentSheet, setCurrentSheet] = useState<XlsxSheet | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const workbookRef = useRef<import('xlsx').WorkBook | null>(null)
  const xlsxModuleRef = useRef<typeof import('xlsx') | null>(null)
  const dataTableRef = useRef<DataTableHandle>(null)
  const updateContent = useUpdateWorkspaceFileContent()
  const updateContentRef = useRef(updateContent)
  updateContentRef.current = updateContent
  const onSaveStatusChangeRef = useRef(onSaveStatusChange)
  onSaveStatusChangeRef.current = onSaveStatusChange

  useEffect(() => {
    if (!fileData) return
    const data = fileData

    let cancelled = false

    async function parse() {
      try {
        setRenderError(null)
        setIsDirty(false)
        const XLSX = await import('xlsx')
        xlsxModuleRef.current = XLSX
        const workbook = XLSX.read(new Uint8Array(data), { type: 'array' })
        if (!cancelled) {
          workbookRef.current = workbook
          setSheetNames(workbook.SheetNames)
          setActiveSheet(0)
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to parse spreadsheet'
          logger.error('XLSX parse failed', { error: msg })
          setRenderError(msg)
        }
      }
    }

    parse()
    return () => {
      cancelled = true
    }
  }, [fileData])

  useEffect(() => {
    if (sheetNames.length === 0 || !workbookRef.current) return

    let cancelled = false

    async function parseSheet() {
      try {
        const XLSX = await import('xlsx')
        const workbook = workbookRef.current!
        const name = sheetNames[activeSheet]
        const sheet = workbook.Sheets[name]
        const allRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })
        const headers = (allRows[0] ?? []) as string[]
        const dataRows = allRows.slice(1) as string[][]
        const truncated = dataRows.length > XLSX_MAX_ROWS
        if (!cancelled) {
          setCurrentSheet({
            name,
            headers,
            rows: truncated ? dataRows.slice(0, XLSX_MAX_ROWS) : dataRows,
            truncated,
          })
        }
      } catch (err) {
        if (!cancelled) {
          const msg = toError(err).message || 'Failed to parse sheet'
          logger.error('XLSX sheet parse failed', { error: msg })
          setRenderError(msg)
        }
      }
    }

    parseSheet()
    return () => {
      cancelled = true
    }
  }, [sheetNames, activeSheet])

  const handleCellChange = useCallback(
    (row: number, col: number, value: string) => {
      const wb = workbookRef.current
      const XLSX = xlsxModuleRef.current
      if (wb && XLSX) {
        const sheetName = sheetNames[activeSheet]
        const ws = wb.Sheets[sheetName]
        if (ws) {
          const cellAddr = XLSX.utils.encode_cell({ r: row + 1, c: col })
          const numValue = Number(value)
          ws[cellAddr] =
            value !== '' && !Number.isNaN(numValue) ? { t: 'n', v: numValue } : { t: 's', v: value }
        }
      }
      setCurrentSheet((prev) => {
        if (!prev) return prev
        const newRows = prev.rows.map((r, ri) =>
          ri === row ? r.map((v, ci) => (ci === col ? value : v)) : r
        )
        return { ...prev, rows: newRows }
      })
      setIsDirty(true)
    },
    [activeSheet, sheetNames]
  )

  const handleHeaderChange = useCallback(
    (col: number, value: string) => {
      const wb = workbookRef.current
      const XLSX = xlsxModuleRef.current
      if (wb && XLSX) {
        const sheetName = sheetNames[activeSheet]
        const ws = wb.Sheets[sheetName]
        if (ws) {
          const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col })
          ws[cellAddr] = { t: 's', v: value }
        }
      }
      setCurrentSheet((prev) => {
        if (!prev) return prev
        const newHeaders = prev.headers.map((h, i) => (i === col ? value : h))
        return { ...prev, headers: newHeaders }
      })
      setIsDirty(true)
    },
    [activeSheet, sheetNames]
  )

  const handleSave = useCallback(async () => {
    // Commit any in-progress cell edit before reading the workbook
    dataTableRef.current?.commitEdit()
    const wb = workbookRef.current
    if (!wb || isSavingRef.current) return

    try {
      isSavingRef.current = true
      setIsSaving(true)
      onSaveStatusChangeRef.current?.('saving')

      const XLSX = await import('xlsx')
      const binary: number[] = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const bytes = new Uint8Array(binary)

      // Convert to base64 in chunks to avoid call stack overflow
      const chunkSize = 8192
      const parts: string[] = []
      for (let i = 0; i < bytes.length; i += chunkSize) {
        parts.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)))
      }
      const base64 = btoa(parts.join(''))

      await updateContentRef.current.mutateAsync({
        workspaceId,
        fileId: file.id,
        content: base64,
        encoding: 'base64',
      })

      setIsDirty(false)
      onSaveStatusChangeRef.current?.('saved')
    } catch (err) {
      logger.error('XLSX save failed', { error: toError(err).message })
      onSaveStatusChangeRef.current?.('error')
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }, [workspaceId, file.id])

  useEffect(() => {
    if (!saveRef) return
    saveRef.current = handleSave
    return () => {
      if (saveRef.current === handleSave) saveRef.current = null
    }
  }, [handleSave, saveRef])

  useEffect(() => {
    if (!canEdit) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canEdit, handleSave])

  const editConfig = useMemo(
    () =>
      canEdit ? { onCellChange: handleCellChange, onHeaderChange: handleHeaderChange } : undefined,
    [canEdit, handleCellChange, handleHeaderChange]
  )

  const error = resolvePreviewError(fetchError, renderError)
  if (error) return <PreviewError label='spreadsheet' error={error} />
  if (isLoading || currentSheet === null) return XLSX_SKELETON

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex shrink-0 items-center justify-between border-[var(--border)] border-b bg-[var(--surface-1)]'>
        <div className='flex gap-0'>
          {sheetNames.map((name, i) => (
            <Button
              key={name}
              variant='ghost'
              size='sm'
              onClick={() => setActiveSheet(i)}
              className={cn(
                'rounded-none px-3 py-1.5 text-[12px]',
                i === activeSheet
                  ? 'border-[var(--brand-secondary)] border-b-2 font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              )}
            >
              {name}
            </Button>
          ))}
        </div>
        {canEdit && isDirty && (
          <Button
            variant='primary'
            size='sm'
            onClick={handleSave}
            disabled={isSaving}
            className='mr-3'
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
      <div className='flex-1 overflow-auto p-6'>
        <DataTable
          ref={dataTableRef}
          headers={currentSheet.headers}
          rows={currentSheet.rows}
          editConfig={editConfig}
        />
        {currentSheet.truncated && (
          <p className='mt-3 text-center text-[12px] text-[var(--text-muted)]'>
            Showing first {XLSX_MAX_ROWS.toLocaleString()} rows. Download the file to view all data.
          </p>
        )}
      </div>
    </div>
  )
})

const UnsupportedPreview = memo(function UnsupportedPreview({
  file,
}: {
  file: WorkspaceFileRecord
}) {
  const ext = getFileExtension(file.name)

  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-[8px]'>
      <p className='font-medium text-[14px] text-[var(--text-body)]'>
        Preview not available{ext ? ` for .${ext} files` : ' for this file'}
      </p>
      <p className='text-[13px] text-[var(--text-muted)]'>
        Use the download button to view this file
      </p>
    </div>
  )
})
