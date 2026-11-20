'use client'

import {
  type CSSProperties,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CodeViewFileItem, SupportedLanguages } from '@pierre/diffs'
import {
  type EditCompletionDecision,
  type Editor,
  type EditorChangeEvent,
  type EditorCommand,
  type EditorFactory,
  type EditorOptions,
  type EditorType,
  Editor as PierreEditor,
  type Position,
  resolveEditorCommandFromKeyboardEvent,
} from '@pierre/diffs/edit'
import { CodeView, type CodeViewHandle, EditProvider } from '@pierre/diffs/react'
import { cn } from '@sim/emcn'
import { EDITOR_SURFACE, usePierreThemeType } from '@/components/code-editor/pierre-theme'

const ITEM_ID = 'document'

const createEditor: EditorFactory<undefined, undefined> = (type, options, editStateKey) =>
  new PierreEditor(type, options, editStateKey)

const rejectCompletion = (): EditCompletionDecision => 'reject'

/** Distance from the bottom, in pixels, inside which a growing document keeps its end in view. */
const FOLLOW_THRESHOLD_PX = 80

/** Commands that change the document, which a read-only editor refuses. */
const EDITING_COMMANDS: ReadonlySet<EditorCommand> = new Set([
  'indent',
  'outdent',
  'indentLess',
  'indentMore',
  'undo',
  'redo',
  'moveLineUp',
  'moveLineDown',
  'copyLineUp',
  'copyLineDown',
  'insertBlankLine',
  'deleteHardLineForward',
  'toggleComment',
  'toggleBlockComment',
  'openSearchReplacePanel',
])

/** Keys the editor turns into edits without naming a command. */
const EDITING_KEYS = new Set(['Enter', 'Backspace', 'Delete'])

/** Events that put text into, or take text out of, the document. */
const MUTATING_EVENTS = [
  'beforeinput',
  'paste',
  'cut',
  'drop',
  'compositionstart',
  'compositionend',
]

/**
 * The editor's chrome in the app's own roles rather than Pierre's VS Code-like defaults:
 * selections and the current search match take the app-wide `::selection` tint, other matches
 * the app's find highlight (as chat's find does), a matched bracket a quiet fill with no
 * underline, and the caret's line a full-width `--surface-hover` band with its number in body
 * text instead of an outlined row.
 *
 * Pierre declares these unlayered inside its shadow root and layers `unsafeCSS` beneath them,
 * so every declaration here is important; nothing else outranks them from outside.
 */
const EDITOR_CHROME_CSS = `
  :host {
    --diffs-editor-selection-bg: var(--selection-muted) !important;
    --diffs-editor-match-bg: var(--selection-muted) !important;
    --diffs-editor-match-highlight-bg: var(--highlight-match-bg) !important;
    --diffs-editor-bracket-match-border: transparent !important;
    --diffs-editor-bracket-match-bg: var(--surface-active) !important;
    --diffs-editor-line-highlight-border: transparent !important;
  }
`

const EDITOR_CSS = `${EDITOR_CHROME_CSS}
  [data-line][data-editor-active-line],
  [data-column-number][data-editor-active-line] {
    --diffs-computed-editor-active-line-bg: var(--surface-hover) !important;
  }
  [data-column-number][data-editor-active-line] { color: var(--text-primary) !important; }
`

/** Read-only marks no caret line, and search keeps its find half without the replace half. */
const READ_ONLY_CSS = `${EDITOR_CHROME_CSS}
  [data-replace-toggle] { display: none !important; }
`

/** The caret in the body text color; a read-only document has no caret worth drawing. */
const EDITOR_TOKENS = {
  ...EDITOR_SURFACE.tokens,
  '--diffs-bg-caret-override': 'var(--text-primary)',
} as CSSProperties

const READ_ONLY_TOKENS = {
  ...EDITOR_SURFACE.tokens,
  '--diffs-bg-caret-override': 'transparent',
} as CSSProperties

/** The selected text and the 1-based lines it spans. */
interface CodeEditorSelection {
  text: string
  startLine: number
  endLine: number
}

export interface CodeEditorHandle {
  getText(): string
  /** The first selection, or null when nothing is selected. */
  getSelection(): CodeEditorSelection | null
  /** Every selection and caret as `[start, end)` offsets into the text. */
  getSelectionRanges(): Array<{ start: number; end: number }>
  /** Replaces every selection with `text`, or inserts it at the caret. Ignored read-only. */
  replaceSelection(text: string): void
  selectAll(): void
  focus(): void
}

interface CodeEditorProps {
  /**
   * The document. A value that differs from what the editor holds is applied as an external
   * update, which keeps the scroll position and does not join the undo history.
   */
  value: string
  /** Names the document; its extension picks the syntax unless `language` is given. */
  fileName: string
  language?: SupportedLanguages
  /** Selection, copy and search still work; every edit is refused. */
  readOnly?: boolean
  onChange?: (value: string) => void
  autoFocus?: boolean
  /** While the document grows, keep its end in view unless the reader has scrolled away. */
  followOutput?: boolean
  className?: string
  ref?: Ref<CodeEditorHandle>
}

function offsetAt(text: string, { line, character }: Position): number {
  let offset = 0
  for (let index = 0; index < line; index++) {
    const newline = text.indexOf('\n', offset)
    if (newline === -1) return text.length
    offset = newline + 1
  }
  return Math.min(offset + character, text.length)
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

/**
 * The one span that differs between `before` and `after`: everything between their common
 * prefix and suffix, as `[start, end)` offsets into `before` and its replacement. Null when they
 * are equal. Never splits a surrogate pair, so both ends map to character positions.
 */
function differingSpan(
  before: string,
  after: string
): { start: number; end: number; text: string } | null {
  if (before === after) return null
  /* A stream appends: settle it with one native comparison instead of a scan. */
  if (after.startsWith(before) && !isHighSurrogate(before.charCodeAt(before.length - 1))) {
    return { start: before.length, end: before.length, text: after.slice(before.length) }
  }
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix--
  let suffix = 0
  while (
    suffix < shorter - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix--
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  }
}

function endOf(text: string): Position {
  const lines = text.split('\n')
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
}

/** Whether an event belongs to a form field inside the editor, such as the search box. */
function isFromField(event: Event): boolean {
  const target = event.composedPath()[0]
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * A code editor on Pierre: syntax highlighted in Sim's palette, virtualized, with search,
 * undo, multiple selections and bracket matching. Light enough for the panel and the file
 * viewer alike; there is no completion or type checking.
 */
export function CodeEditor({
  value,
  fileName,
  language,
  readOnly = false,
  onChange,
  autoFocus = false,
  followOutput = false,
  className,
  ref,
}: CodeEditorProps) {
  const themeType = usePierreThemeType()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<CodeViewHandle<undefined, undefined>>(null)
  const editorRef = useRef<Editor<'file'> | null>(null)
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const valueRef = useRef(value)
  valueRef.current = value
  const followingRef = useRef(true)

  /* What the editor holds, and the document handed to Pierre when it has no editor to edit. */
  const [editorText, setEditorText] = useState(value)
  const [published, setPublished] = useState({ contents: value, version: 0 })

  /*
   * An external value (a stream, a refresh, a reload) reaches the editor as the one span that
   * changed, so a streamed append costs the size of the append rather than of the document,
   * and the scroll position, selection and tokens of every unchanged line stay put. The edit
   * reports back through `handleEditChange`, which keeps it out of the undo history. Before the
   * editor attaches, the item itself carries the value.
   */
  useLayoutEffect(() => {
    if (value === editorText) return
    const editor = editorRef.current
    const document = editor?.getEditState()?.document
    if (!editor || !document) {
      setPublished((current) => ({ contents: value, version: current.version + 1 }))
      setEditorText(value)
      return
    }
    const span = differingSpan(editorText, value)
    if (!span) return
    editor.applyEdits(
      [
        {
          range: { start: document.positionAt(span.start), end: document.positionAt(span.end) },
          newText: span.text,
        },
      ],
      false
    )
  }, [value, editorText])

  const items = useMemo(
    (): CodeViewFileItem[] => [
      {
        id: ITEM_ID,
        type: 'file',
        file: { name: fileName, contents: published.contents, lang: language },
        edit: true,
        version: published.version,
      },
    ],
    [fileName, language, published]
  )

  /* Creation-time options: Pierre reads them once, when it builds the editor. */
  const [editorOptions] = useState<Omit<EditorOptions<'file', undefined, undefined>, 'onChange'>>(
    () => ({
      onAttach: (editor) => {
        editorRef.current = editor
        if (autoFocus) editor.focus({ preventScroll: true })
      },
    })
  )

  useImperativeHandle(
    ref,
    () => ({
      getText: () => editorRef.current?.getText() ?? editorText,
      getSelection: () => {
        const editor = editorRef.current
        const selection = editor?.getViewState().selections?.[0]
        if (!editor || !selection) return null
        const text = editor.getText()
        const start = offsetAt(text, selection.start)
        const end = offsetAt(text, selection.end)
        if (start === end) return null
        /* A selection ending at the start of a line takes nothing from that line. */
        const endLine =
          selection.end.character === 0 && selection.end.line > selection.start.line
            ? selection.end.line
            : selection.end.line + 1
        return {
          text: text.slice(Math.min(start, end), Math.max(start, end)),
          startLine: selection.start.line + 1,
          endLine,
        }
      },
      getSelectionRanges: () => {
        const editor = editorRef.current
        if (!editor) return []
        const text = editor.getText()
        return (editor.getViewState().selections ?? []).map((selection) => {
          const anchor = offsetAt(text, selection.start)
          const focus = offsetAt(text, selection.end)
          return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
        })
      },
      replaceSelection: (text) => {
        const editor = editorRef.current
        if (!editor || readOnlyRef.current) return
        const selections = editor.getViewState().selections ?? []
        editor.applyEdits(
          selections.map((selection) => ({
            range: { start: selection.start, end: selection.end },
            newText: text,
          }))
        )
      },
      selectAll: () => {
        const editor = editorRef.current
        if (!editor) return
        editor.setSelections([
          {
            start: { line: 0, character: 0 },
            end: endOf(editor.getText()),
            direction: 'forward',
          },
        ])
      },
      focus: () => editorRef.current?.focus({ preventScroll: true }),
    }),
    [editorText]
  )

  /** Read-only is a guard in front of a live editor, so search and selection keep working. */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const refuse = (event: Event) => {
      if (!readOnlyRef.current || isFromField(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const refuseEditingKeys = (event: KeyboardEvent) => {
      if (!readOnlyRef.current || isFromField(event)) return
      /* Tab leaves a read-only document, as it does any other read-only field, instead of indenting. */
      if (event.key === 'Tab') {
        event.stopPropagation()
        return
      }
      const command = resolveEditorCommandFromKeyboardEvent(event)
      if ((command && EDITING_COMMANDS.has(command)) || EDITING_KEYS.has(event.key)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    /*
     * Closing search removes its field, which drops focus to the page; hand it back to the
     * document, whose caret search left on the last match, so typing and shortcuts carry on.
     */
    const returnFocusFromClosedField = (event: FocusEvent) => {
      const field = event.composedPath()[0]
      if (!(field instanceof HTMLInputElement) || event.relatedTarget !== null) return
      queueMicrotask(() => {
        if (field.isConnected || document.activeElement !== document.body) return
        editorRef.current?.focus({ preventScroll: true })
      })
    }
    /* The editor moves its caret on any press; a right-click keeps the selection for a context menu. */
    const keepSelectionOnSecondaryPress = (event: PointerEvent) => {
      if (event.button === 2) event.stopPropagation()
    }
    for (const type of MUTATING_EVENTS) container.addEventListener(type, refuse, true)
    container.addEventListener('keydown', refuseEditingKeys, true)
    container.addEventListener('pointerdown', keepSelectionOnSecondaryPress, true)
    container.addEventListener('focusout', returnFocusFromClosedField)
    return () => {
      for (const type of MUTATING_EVENTS) container.removeEventListener(type, refuse, true)
      container.removeEventListener('keydown', refuseEditingKeys, true)
      container.removeEventListener('pointerdown', keepSelectionOnSecondaryPress, true)
      container.removeEventListener('focusout', returnFocusFromClosedField)
    }
  }, [])

  useEffect(() => {
    if (!followOutput || !followingRef.current) return
    viewRef.current?.scrollTo({ type: 'item', id: ITEM_ID, align: 'end' })
  }, [followOutput, value])

  /* CodeView rebuilds on any new option or callback identity, so each one is stable. */
  const options = useMemo(
    () => ({
      ...EDITOR_SURFACE.options,
      themeType,
      disableFileHeader: true,
      overflow: 'wrap' as const,
      unsafeCSS: readOnly ? READ_ONLY_CSS : EDITOR_CSS,
    }),
    [themeType, readOnly]
  )

  const handleScroll = useCallback((scrollTop: number) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    followingRef.current =
      scroller.scrollHeight - scrollTop - scroller.clientHeight < FOLLOW_THRESHOLD_PX
  }, [])

  const handleEditChange = useCallback(
    (event: EditorChangeEvent<EditorType, undefined, undefined>) => {
      const text = event.file.contents
      /*
       * Applying an external update reports it too; only the user's edits are changes. The update
       * replaced the document, so undo must not step back into what it replaced.
       */
      if (text === valueRef.current) {
        event.editor.getEditState()?.document.clearHistory()
        setEditorText(text)
        return
      }
      /* An edit the guard could not intercept (an IME commit) is undone by restoring the value. */
      if (readOnlyRef.current) {
        setPublished((current) => ({ contents: valueRef.current, version: current.version + 1 }))
        return
      }
      setEditorText(text)
      onChangeRef.current?.(text)
    },
    []
  )

  return (
    <div
      ref={containerRef}
      data-code-editor=''
      data-read-only={readOnly || undefined}
      className={cn('h-full min-h-0 bg-[var(--bg)]', className)}
      style={readOnly ? READ_ONLY_TOKENS : EDITOR_TOKENS}
    >
      <EditProvider createEditor={createEditor}>
        <CodeView
          ref={viewRef}
          items={items}
          className='h-full overflow-auto'
          editorOptions={editorOptions}
          options={options}
          containerRef={scrollerRef}
          onScroll={handleScroll}
          onItemEditChange={handleEditChange}
          onItemEditComplete={rejectCompletion}
        />
      </EditProvider>
    </div>
  )
}
