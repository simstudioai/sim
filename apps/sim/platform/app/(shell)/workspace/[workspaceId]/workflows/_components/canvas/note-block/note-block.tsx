'use client'

import {
  type ComponentProps,
  createContext,
  type DragEvent,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn/lib/cn'
import { getEmbedInfo } from '@sim/utils/media-embed'
import { type Node, type NodeProps, useReactFlow } from '@xyflow/react'
import dynamic from 'next/dynamic'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown'
import { useShallow } from 'zustand/react/shallow'
import { ActionBar } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/action-bar/action-bar'
import {
  type BlockRing,
  useBlockVisual,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/block-visual/use-block-visual'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/note-block/note-block.module.css'
import {
  countNoteSearchOccurrencesBefore,
  forEachNoteSourceOccurrence,
  type NoteSearchHighlight,
  type NoteSearchRange,
  noteSearchHighlightPlugin,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/note-block/search-highlight'
import { useNoteImageUpload } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/note-block/use-note-image-upload'
import {
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/border'
import { CanvasTooltip } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/canvas-tooltip'
import { handleKeyboardActivation } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/keyboard'
import { OverflowSpan } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/overflow-span'
import { useActionMenuSwell } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/use-action-menu-swell'
import {
  appendNoteImageMarkdown,
  BLOCK_DIMENSIONS,
  ChevronsDownUp,
  clampNoteBlockHeight,
  DEFAULT_NOTE_COLOR,
  Expand,
  estimateNoteBlockHeight,
  getNoteColorOption,
  getNoteStringValue,
  isNoteColor,
  isWorkflowBlockProtected,
  NOTE_ADD_IMAGE_EVENT,
  NOTE_RENAME_EVENT,
  type NoteBlockRequestDetail,
  type NoteColor,
  useBlockDimensions,
  useCollaborativeWorkflow,
  useIsCurrentWorkflowExecuting,
  usePanelEditorSearchStore,
  usePanelEditorStore,
  useSubBlockStore,
  useUserPermissionsContext,
  useWorkflowStore,
  type WorkflowBlockProps,
} from '@/platform/lib/data/workflows'

const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_AMPLITUDE = 7
const EDIT_CLICK_TOLERANCE_PX = 4

type NoteEditingField = 'title' | 'content' | null

/** Props the card hands its injected markdown editor. */
export interface NoteContentEditorProps {
  value: string
  /** The note colour's selection tint, applied to the editor's own prose. */
  selectionClassName: string
  /** The note colour's caret, so the cursor reads against the card's own fill. */
  caretClassName: string
  /**
   * Viewport point of the click that opened editing, so the caret lands where
   * the user aimed. The read view sits under a full-bleed overlay that has to
   * swallow that click to enter editing, so the position cannot reach the
   * editor any other way. Null for keyboard activation, which has no point.
   */
  openedAt: { clientX: number; clientY: number } | null
  /** Persists as the user types; the note has no uncommitted buffer. */
  onChange: (content: string) => void
}

interface EditPointerStart {
  field: Exclude<NoteEditingField, null>
  x: number
  y: number
}

interface NotePointerStart {
  x: number
  y: number
}

/**
 * The ink each palette colour paints its card with — the legacy option's text, placeholder,
 * selection and caret classes, as this module's classes. Keyed by every colour, so a new palette
 * entry fails the type-check until it is given its ink.
 */
const NOTE_INK = {
  white: {
    text: styles.textDark,
    placeholder: styles.placeholderDark,
    selection: styles.selectionDark,
    caret: styles.caretDark,
  },
  'light-gray': {
    text: styles.textDark,
    placeholder: styles.placeholderDark,
    selection: styles.selectionDark,
    caret: styles.caretDark,
  },
  carbon: {
    text: styles.textLight,
    placeholder: styles.placeholderLight,
    selection: styles.selectionLight,
    caret: styles.caretLight,
  },
} satisfies Record<
  NoteColor,
  { text: string; placeholder: string; selection: string; caret: string }
>

/**
 * Whether a drag carries files rather than one of the canvas's own payloads.
 *
 * The toolbar's block drags put `application/json` on the transfer and nothing
 * else, so keying on `Files` is what keeps a note from claiming a drop the
 * canvas is meant to place.
 */
function isFileDrag(transfer: DataTransfer | null): boolean {
  return transfer ? Array.from(transfer.types).includes('Files') : false
}

/** The image files on a drop, in the order the browser reports them. */
function imageFilesFrom(transfer: DataTransfer | null): File[] {
  return transfer ? Array.from(transfer.files).filter((file) => file.type.startsWith('image/')) : []
}

/**
 * Compact markdown renderer for note blocks with tight spacing.
 *
 * Streamdown's `remarkPlugins` prop REPLACES its defaults rather than extending
 * them, and GFM is one of those defaults — so passing `remarkBreaks` alone
 * silently dropped task lists, tables, strikethrough and autolinks from the read
 * view. The editor writes all four (it has TaskList, TableKit and Strike), so a
 * note round-tripped through editing came back as raw `- [x]` source.
 */
const NOTE_REMARK_PLUGINS = [remarkGfm, remarkBreaks]

/**
 * The ordinal of the mark to paint as current, or null when no workflow search
 * points at this note.
 *
 * Carried by context rather than by prop because the rehype plugin below is
 * keyed on the query alone: cycling between two matches inside one note then
 * re-renders the marks instead of re-parsing the whole document on every press
 * of Enter.
 */
const NoteSearchActiveIndexContext = createContext<number | null>(null)

interface NoteSearchMarkProps {
  children?: ReactNode
  'data-note-search-index'?: string
}

/*
 * A note paints its own card fill, so the editor panel's fixed orange cannot
 * simply be reused: it disappears against a light card and fights the white
 * text on a dark one. Other matches wash the card's own colour, and the current
 * one paints both fill and text so it reads on every colour in the palette.
 */
function NoteSearchMark({
  children,
  'data-note-search-index': indexAttribute,
}: NoteSearchMarkProps) {
  const activeIndex = useContext(NoteSearchActiveIndexContext)
  const index = Number.parseInt(indexAttribute ?? '', 10)
  const isActive = Number.isInteger(index) && index === activeIndex

  return (
    <mark
      data-note-search-active={isActive ? '' : undefined}
      className={isActive ? styles.searchMarkActive : styles.searchMark}
    >
      {children}
    </mark>
  )
}

/**
 * The title with its search hit marked, or undefined to render it plain.
 *
 * Takes a range rather than a query: a name match carries an exact one, so
 * there is no occurrence to guess at the way there is in the markdown body.
 */
function renderMarkedName(name: string, range: NoteSearchRange | null): ReactNode | undefined {
  if (!range) return undefined
  return (
    <>
      {name.slice(0, range.start)}
      <mark data-note-search-active='' className={styles.searchMarkActive}>
        {name.slice(range.start, range.end)}
      </mark>
      {name.slice(range.end)}
    </>
  )
}

const NOTE_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <p className={styles.paragraph}>{children}</p>,
  h1: ({ children }: { children?: ReactNode }) => <h1 className={styles.h1}>{children}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2 className={styles.h2}>{children}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3 className={styles.h3}>{children}</h3>,
  h4: ({ children }: { children?: ReactNode }) => <h4 className={styles.h4}>{children}</h4>,
  /* Streamdown's own `h5`, `h6`, `hr`, `sup` and `sub` paint Tailwind classes the legacy app compiled;
     the zone compiles none, so their rules travel here. */
  h5: ({ children }: { children?: ReactNode }) => (
    <h5 className={styles.h5} data-streamdown='heading-5'>
      {children}
    </h5>
  ),
  h6: ({ children }: { children?: ReactNode }) => (
    <h6 className={styles.h6} data-streamdown='heading-6'>
      {children}
    </h6>
  ),
  hr: () => <hr className={styles.rule} data-streamdown='horizontal-rule' />,
  sup: ({ children }: { children?: ReactNode }) => (
    <sup className={styles.script} data-streamdown='superscript'>
      {children}
    </sup>
  ),
  sub: ({ children }: { children?: ReactNode }) => (
    <sub className={styles.script} data-streamdown='subscript'>
      {children}
    </sub>
  ),
  /* A checklist is not a bulleted list: remark-gfm marks it `contains-task-list`,
     and the disc and left padding have to come off or every checkbox sits behind
     a bullet. Same rule the editor's shared node chrome applies. */
  ul: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <ul
      className={cn(
        styles.list,
        className?.includes('contains-task-list') ? styles.listTasks : styles.listDisc
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className={cn(styles.list, styles.listDecimal)}>{children}</ol>
  ),
  li: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <li className={cn(styles.listItem, className?.includes('task-list-item') && styles.taskItem)}>
      {children}
    </li>
  ),
  /* `disabled` is what remark-gfm emits and what the read view wants: the note is not interactive
     until you click into it, and then the editor owns the control. */
  input: ({ type, checked }: ComponentProps<'input'>) =>
    type === 'checkbox' ? (
      <input type='checkbox' checked={checked} disabled className={styles.taskCheckbox} />
    ) : null,
  /**
   * `width`/`height` are load-bearing, not decoration: resizing an image in the editor commits the
   * new width to the node and it serializes as `<img width>`, since markdown has no size syntax.
   * Dropping them here rendered every image at its natural size in the read view, so a resized note
   * flipped between two sizes as editing opened and closed.
   *
   * `height: auto` keeps the aspect ratio when `max-width: 100%` shrinks a wide image below its
   * stated width — the same pairing the editor's node view uses, so both views agree at every card
   * width.
   */
  img: ({ src, alt, width, height }: ComponentProps<'img'>) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      width={width}
      height={height}
      className={styles.image}
    />
  ),
  inlineCode: ({ children }: { children?: ReactNode }) => (
    <code className={styles.inlineCode}>{children}</code>
  ),
  code: ({ children, className, ...props }: { children?: ReactNode; className?: string }) => (
    <code {...props} className={styles.code}>
      {children}
    </code>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const embedInfo = href ? getEmbedInfo(href) : null
    if (embedInfo) {
      return (
        <span className={styles.embed}>
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(styles.link, styles.embedLink)}
          >
            {children}
          </a>
          <span className={styles.embedFrame}>
            {embedInfo.type === 'iframe' && (
              <span
                className={styles.embedViewport}
                style={{
                  width: '100%',
                  aspectRatio: embedInfo.aspectRatio || '16/9',
                }}
              >
                <iframe
                  src={embedInfo.url}
                  title='Media'
                  allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                  allowFullScreen
                  loading='lazy'
                  className={styles.embedIframe}
                  style={{
                    width: EMBED_INVERSE_SCALE,
                    height: EMBED_INVERSE_SCALE,
                    transform: `scale(${EMBED_SCALE})`,
                  }}
                />
              </span>
            )}
            {embedInfo.type === 'video' && (
              <video src={embedInfo.url} controls preload='metadata' className={styles.embedVideo}>
                <track kind='captions' src='' default />
              </video>
            )}
            {embedInfo.type === 'audio' && (
              <audio src={embedInfo.url} controls preload='metadata' className={styles.embedAudio}>
                <track kind='captions' src='' default />
              </audio>
            )}
          </span>
        </span>
      )
    }
    return (
      <a href={href} target='_blank' rel='noopener noreferrer' className={styles.link}>
        {children}
      </a>
    )
  },
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className={styles.strong}>{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => <em className={styles.emphasis}>{children}</em>,
  mark: NoteSearchMark,
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className={styles.blockquote}>{children}</blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className={styles.tableWrap}>
      <table className={styles.table}>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className={styles.tableHead}>{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => <tr className={styles.tableRow}>{children}</tr>,
  th: ({ children }: { children?: ReactNode }) => (
    <th className={styles.tableHeaderCell}>{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => <td className={styles.tableCell}>{children}</td>,
}

interface NoteMarkdownProps {
  content: string
  /** Omitted when no search points here, so the pipeline stays the default one. */
  searchQuery?: string
}

const NoteMarkdown = memo(function NoteMarkdown({ content, searchQuery }: NoteMarkdownProps) {
  /*
   * `defaultRehypePlugins` is a record keyed by role, not a list — the array
   * Streamdown actually defaults to is `Object.values` of it, in that order.
   * Appending rather than replacing is what keeps this note's sanitization and
   * link hardening intact; the marks are added afterwards precisely because
   * sanitization would otherwise strip them as an unknown tag.
   */
  const rehypePlugins = useMemo<StreamdownProps['rehypePlugins']>(
    () =>
      searchQuery
        ? [
            ...Object.values(defaultRehypePlugins),
            [noteSearchHighlightPlugin, { query: searchQuery }],
          ]
        : undefined,
    [searchQuery]
  )

  return (
    /*
     * Keyed on the query so a change to it remounts.
     *
     * Streamdown is memoised behind a hand-written comparator that checks
     * `children`, `mode`, `className`, `dir` and friends — but NOT
     * `rehypePlugins`, `remarkPlugins` or `components`. Starting or ending a
     * search changes only the plugin list, so without a key Streamdown bails
     * out and keeps its previous render: marks appear only if something else
     * happens to remount the card, and once painted they survive the query
     * being cleared. The key is the query rather than a counter because the
     * pipeline genuinely has to re-parse when the plugin changes; the current
     * occurrence still travels by context, so cycling matches inside one note
     * re-renders the marks without remounting the document.
     */
    <Streamdown
      key={searchQuery ?? ''}
      mode='static'
      className={styles.flow}
      remarkPlugins={NOTE_REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={NOTE_COMPONENTS}
    >
      {content}
    </Streamdown>
  )
})

/**
 * Props for the pure note renderer. The container resolves the markdown content
 * (from the block's subblock value), enabled/ring visual state, and the select
 * handler; the editor-only action bar is injected via the `actionBar` slot.
 */
interface NoteBlockViewProps {
  name?: string
  /** Markdown content; an empty string renders the placeholder. */
  content: string
  noteColor?: NoteColor
  isEnabled: boolean
  isFocused: boolean
  isExpanded?: boolean
  canEdit?: boolean
  hasRing: boolean
  ring: BlockRing | null
  /** Notifies the host while keeping Note selection out of the side editor. */
  onSelect: () => void
  /** Persists an inline title edit and reports whether validation succeeded. */
  onNameChange?: (name: string) => boolean
  /** Persists inline note content as the user types. */
  onContentChange?: (content: string) => void
  /**
   * A count of writes the host has made to `content` from outside the editor —
   * the canvas "Add image" action and {@link onImageFilesDrop} today. Each one
   * ends any in-progress content editing, because the editor seeds its document
   * once when editing opens: left running, its next keystroke would serialize
   * that stale document straight over the host's write.
   */
  externalContentWrites?: number
  /**
   * A count of rename requests the host has made from outside the card — the
   * canvas context menu's "Rename" is the only one today. The card is the only
   * surface that can rename a note (the panel editor renders nothing for one),
   * and its title is only clickable once expanded, so the host expands the card
   * and bumps this together.
   */
  externalRenameRequests?: number
  /** Publishes the measured, clamped canvas height to the editor container. */
  onHeightChange?: (height: number) => void
  onExpandedChange?: (expanded: boolean) => void
  /**
   * Uploads image files dropped anywhere on the card and appends them to the
   * note, for the drop the editor cannot take: the card is a read view until it
   * is expanded and clicked into, so without this the natural gesture — drag an
   * image from Finder onto the note — lands on the canvas and is swallowed.
   * Omit to leave the card inert to file drops.
   */
  onImageFilesDrop?: (files: File[]) => void
  /** Renders the markdown editor. */
  renderContentEditor: (props: NoteContentEditorProps) => ReactNode
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
  /**
   * The workflow search match to paint, or null when no search points here.
   *
   * Applies to the read view only. A note the user has clicked into is a live
   * markdown editor holding its own document, and repainting a match inside it
   * would put decorations on text the user is editing; the highlight comes back
   * when they click out.
   */
  searchHighlight?: NoteSearchHighlight | null
  /**
   * Range of a workflow search hit inside `name`, or null. Separate from
   * {@link searchHighlight} because a title and a body are different surfaces
   * with different match shapes, and only one of the two can be current.
   */
  nameSearchRange?: NoteSearchRange | null
}

/**
 * Pure renderer for a canvas Note card with a title and markdown body. Compact
 * Notes remain draggable; expanded Notes provide stable inline editing without
 * store, socket, or permission coupling.
 */
function NoteBlockView({
  name,
  content,
  noteColor = DEFAULT_NOTE_COLOR,
  isEnabled,
  isFocused,
  isExpanded = false,
  canEdit = false,
  hasRing,
  ring,
  onSelect,
  onNameChange,
  onContentChange,
  externalContentWrites = 0,
  externalRenameRequests = 0,
  onHeightChange,
  onExpandedChange,
  onImageFilesDrop,
  renderContentEditor,
  actionBar,
  searchHighlight = null,
  nameSearchRange = null,
}: NoteBlockViewProps) {
  const colorOption = getNoteColorOption(noteColor)
  const ink = NOTE_INK[noteColor]
  const showActionMenu = Boolean(actionBar)
  const noteLayoutRef = useRef<HTMLDivElement>(null)
  const scrollRegionRef = useRef<HTMLElement>(null)
  const contentMeasureRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editPointerStartRef = useRef<EditPointerStart>(null)
  const notePointerStartRef = useRef<NotePointerStart>(null)
  const [editingField, setEditingField] = useState<NoteEditingField>(null)
  const [contentEditOpenedAt, setContentEditOpenedAt] = useState<{
    clientX: number
    clientY: number
  } | null>(null)
  const [draftName, setDraftName] = useState(name ?? '')
  const [draftContent, setDraftContent] = useState(content)
  const [compactHeight, setCompactHeight] = useState(() => estimateNoteBlockHeight(content))
  const [isHovered, setIsHovered] = useState(false)
  const [isFileDropTarget, setIsFileDropTarget] = useState(false)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
  /* Unpacked to primitives so the scroll below re-runs when the match moves and
     not merely when the search panel hands over an equal target under a new
     identity — which it does often, and which would yank a note the user has
     scrolled by hand back onto the mark. */
  const searchQuery = searchHighlight?.query
  const searchOccurrenceIndex = searchHighlight?.occurrenceIndex
  const activeContent = editingField === 'content' ? draftContent : content
  const isEmpty = activeContent.trim().length === 0
  const hasVisualFocus = isFocused || isExpanded
  const isInlineEditable = isExpanded && canEdit
  const blockWidth = isExpanded ? BLOCK_DIMENSIONS.NOTE_EXPANDED_WIDTH : BLOCK_DIMENSIONS.NOTE_WIDTH
  const blockHeight = isExpanded ? BLOCK_DIMENSIONS.NOTE_EXPANDED_HEIGHT : compactHeight
  /*
   * The node's canvas footprint stays at the compact height while the card
   * overlays at its expanded size, so expanding never shifts the layer below.
   * `compactHeight` is only ever measured at the compact width, so it already
   * holds that value throughout the expansion — no separate anchor needed.
   */
  const layoutHeight = compactHeight
  const isContentScrollable = canScrollUp || canScrollDown

  useEffect(() => {
    if (!isInlineEditable) setEditingField(null)
  }, [isInlineEditable])

  /* Hands the document back to `content`. Idempotent, so the mount-time run and
     any repeat are both no-ops when nothing is being edited. */
  useEffect(() => {
    setEditingField((field) => (field === 'content' ? null : field))
  }, [externalContentWrites])

  /*
   * Opens the title on the host's request. Declared after the guard above so it
   * wins within the same commit: the host expands the card and bumps the count
   * together, and the guard would otherwise clear the field it just set. The
   * zero check skips the mount run, which is not a request.
   */
  const requestedRenameRef = useRef(externalRenameRequests)
  useEffect(() => {
    if (externalRenameRequests === requestedRenameRef.current) return
    requestedRenameRef.current = externalRenameRequests
    if (!isInlineEditable) return
    setDraftName(name ?? '')
    setEditingField('title')
  }, [externalRenameRequests, isInlineEditable, name])

  useEffect(() => {
    if (!isExpanded || !onExpandedChange) return

    const handleCanvasPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      if (noteLayoutRef.current?.contains(event.target)) return
      if (!event.target.closest('.react-flow__pane, .react-flow__node')) return

      onExpandedChange(false)
    }

    document.addEventListener('pointerdown', handleCanvasPointerDown, true)
    return () => document.removeEventListener('pointerdown', handleCanvasPointerDown, true)
  }, [isExpanded, onExpandedChange])

  /* Content focus is the injected editor's own concern — it owns its caret. */
  useEffect(() => {
    if (editingField !== 'title') return
    const input = titleInputRef.current
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  }, [editingField])

  function startEditing(
    event: ReactMouseEvent<HTMLElement>,
    field: Exclude<NoteEditingField, null>
  ) {
    event.stopPropagation()
    if (!isInlineEditable) return

    const pointerStart = editPointerStartRef.current
    editPointerStartRef.current = null
    const isKeyboardActivation = event.detail === 0
    const isIntentionalClick =
      pointerStart?.field === field &&
      Math.abs(event.clientX - pointerStart.x) <= EDIT_CLICK_TOLERANCE_PX &&
      Math.abs(event.clientY - pointerStart.y) <= EDIT_CLICK_TOLERANCE_PX
    if (!isKeyboardActivation && !isIntentionalClick) return

    if (field === 'title') setDraftName(name ?? '')
    if (field === 'content') {
      setDraftContent(content)
      setContentEditOpenedAt(
        isKeyboardActivation ? null : { clientX: event.clientX, clientY: event.clientY }
      )
    }
    setEditingField(field)
  }

  function recordEditPointerStart(
    event: ReactPointerEvent<HTMLElement>,
    field: Exclude<NoteEditingField, null>
  ) {
    editPointerStartRef.current = {
      field,
      x: event.clientX,
      y: event.clientY,
    }
  }

  function recordNotePointerStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hasVisualFocus || isExpanded || !canEdit || event.button !== 0) return
    notePointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    }
  }

  function handleNoteClick(event: ReactMouseEvent<HTMLDivElement>) {
    const pointerStart = notePointerStartRef.current
    notePointerStartRef.current = null

    if (!hasVisualFocus) {
      onSelect()
      return
    }

    if (!isExpanded && canEdit && onExpandedChange) {
      const isKeyboardActivation = event.detail === 0
      const isIntentionalClick =
        pointerStart !== null &&
        Math.abs(event.clientX - pointerStart.x) <= EDIT_CLICK_TOLERANCE_PX &&
        Math.abs(event.clientY - pointerStart.y) <= EDIT_CLICK_TOLERANCE_PX
      if (isKeyboardActivation || isIntentionalClick) {
        onExpandedChange(true)
        return
      }
    }

    onSelect()
  }

  function finishTitleEditing() {
    const currentName = name ?? ''
    const nextName = draftName.trim()
    if (nextName !== currentName) {
      const didSave = onNameChange?.(nextName) ?? false
      if (!didSave) setDraftName(currentName)
    }
    setEditingField(null)
  }

  function cancelTitleEditing() {
    setDraftName(name ?? '')
    setEditingField(null)
  }

  const acceptsImageDrop = Boolean(onImageFilesDrop) && canEdit

  /**
   * Claims a file drag for the card.
   *
   * A drop only fires where the `dragover` was cancelled, and the canvas cancels
   * its own on the pane behind — so without this the file lands on the canvas,
   * which has nothing to do with it, and the drag reads as rejected.
   */
  function handleFileDragOver(event: DragEvent<HTMLDivElement>) {
    if (!acceptsImageDrop || !isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsFileDropTarget(true)
  }

  function handleFileDragLeave(event: DragEvent<HTMLDivElement>) {
    /* `dragleave` fires on every crossing into a child as well, and Chrome
       reports no `relatedTarget` for it — so the pointer's own position is what
       says whether the card was really left. Reading the node tree instead
       flickers the highlight off and back on across every child boundary. */
    const rect = event.currentTarget.getBoundingClientRect()
    const isInsideCard =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    if (isInsideCard) return
    setIsFileDropTarget(false)
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    setIsFileDropTarget(false)
    if (!acceptsImageDrop) return
    /* An open editor takes the drop first — it inserts at the point the user
       aimed at and marks the event handled. Appending here as well would store
       a second copy of the same image. */
    if (event.defaultPrevented) return

    const images = imageFilesFrom(event.dataTransfer)
    if (images.length === 0) return
    event.preventDefault()
    onImageFilesDrop?.(images)
  }

  const updateScrollFades = useCallback(() => {
    const scrollRegion = scrollRegionRef.current
    if (!scrollRegion) return
    const maxScrollTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight)
    setCanScrollUp(scrollRegion.scrollTop > 1)
    setCanScrollDown(scrollRegion.scrollTop < maxScrollTop - 1)
  }, [])
  const setScrollRegion = useCallback(
    (node: HTMLElement | null) => {
      scrollRegionRef.current = node
      updateScrollFades()
    },
    [updateScrollFades]
  )

  /**
   * Measures the compact height, and only ever at the compact width.
   *
   * An expanded note lays out at `NOTE_EXPANDED_WIDTH`, where the same text
   * re-wraps shorter. Measuring there would publish that shorter height as the
   * node's stored height for as long as the note stayed open — the collapse
   * would then animate to the wrong height and snap once a compact re-measure
   * landed.
   *
   * `editingField` gates this too, and belongs in the dependency list: the
   * measured node only exists in the non-editing branch, and `editingField` is
   * cleared by a passive effect, so a collapse that skips blur (losing edit
   * rights, or the canvas pointerdown capture) commits one frame where the note
   * is collapsed but the editor is still mounted. Measuring there publishes a
   * raw estimate, and without the dependency neither this callback nor the
   * observer below would re-run once the real node came back.
   */
  const measureBlockHeight = useCallback(() => {
    if (isExpanded || editingField === 'content') return

    const measuredContentHeight = isEmpty ? 0 : (contentMeasureRef.current?.scrollHeight ?? 0)
    const nextCompactHeight =
      measuredContentHeight > 0
        ? clampNoteBlockHeight(measuredContentHeight)
        : estimateNoteBlockHeight(activeContent)

    setCompactHeight((currentHeight) =>
      currentHeight === nextCompactHeight ? currentHeight : nextCompactHeight
    )
    onHeightChange?.(nextCompactHeight)
  }, [activeContent, editingField, isEmpty, isExpanded, onHeightChange])

  useLayoutEffect(() => {
    measureBlockHeight()
  }, [measureBlockHeight])

  useEffect(() => {
    if (isExpanded || editingField === 'content' || !contentMeasureRef.current) return
    const observer = new ResizeObserver(measureBlockHeight)
    observer.observe(contentMeasureRef.current)
    return () => observer.disconnect()
  }, [editingField, isExpanded, measureBlockHeight])

  useEffect(() => {
    if (!hasVisualFocus && scrollRegionRef.current) {
      scrollRegionRef.current.scrollTop = 0
    }
    updateScrollFades()
  }, [content, editingField, hasVisualFocus, updateScrollFades])

  /**
   * Scrolls the current search match into the card's own scroll region.
   *
   * `scrollTop` arithmetic, never `scrollIntoView`: the card sits inside
   * ReactFlow's transformed viewport, and `scrollIntoView` keeps walking past
   * this region to scroll every scrollable ancestor — which drags the canvas
   * itself off-frame. Summing `offsetTop` up the offset-parent chain stays in
   * layout space, so the canvas zoom never enters the arithmetic.
   *
   * Called again when the card finishes resizing, because the host expands a
   * note that holds a match: the region's height animates for 280ms, so the
   * position computed on arrival is measured against a card that is still
   * growing.
   */
  const scrollActiveMatchIntoView = useCallback(() => {
    const scrollRegion = scrollRegionRef.current
    const activeMark = scrollRegion?.querySelector<HTMLElement>('[data-note-search-active]')
    if (!scrollRegion || !activeMark) return

    let markTop = 0
    let ancestor: HTMLElement | null = activeMark
    while (ancestor && ancestor !== scrollRegion) {
      markTop += ancestor.offsetTop
      const nextAncestor: Element | null = ancestor.offsetParent
      ancestor = nextAncestor instanceof HTMLElement ? nextAncestor : null
    }
    /* The walk left the region without passing through it — the offsets just
       summed are measured against something else entirely. */
    if (!ancestor) return

    const maxScrollTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight)
    const centeredTop = markTop - (scrollRegion.clientHeight - activeMark.offsetHeight) / 2
    scrollRegion.scrollTop = Math.max(0, Math.min(centeredTop, maxScrollTop))
    updateScrollFades()
  }, [updateScrollFades])

  /**
   * Declared after the reset above so it wins the commit where a note gains
   * both focus and a match.
   */
  useEffect(() => {
    if (searchQuery === undefined || editingField === 'content') return
    scrollActiveMatchIntoView()
  }, [
    content,
    editingField,
    isExpanded,
    scrollActiveMatchIntoView,
    searchOccurrenceIndex,
    searchQuery,
  ])

  const {
    rootRef: actionMenuRootRef,
    hostRef: actionMenuHostRef,
    width: actionMenuWidth,
    swellOpen: actionMenuSwellOpen,
    contentVisible: actionMenuContentVisible,
    setReady: setActionMenuSwellReady,
    onFocusCapture: handleActionMenuFocus,
    onBlurCapture: handleActionMenuBlur,
  } = useActionMenuSwell({
    enabled: showActionMenu,
    forceOpen: hasVisualFocus,
    maxWidth: blockWidth - ACTION_MENU_RIGHT_INSET_PX * 2,
  })
  const borderPorts = useMemo<WorkflowBorderPort[]>(
    () =>
      showActionMenu
        ? [
            {
              id: 'action-menu',
              side: 'top',
              position: { fromEnd: ACTION_MENU_RIGHT_INSET_PX + actionMenuWidth / 2 },
              plateau: actionMenuWidth,
              restAmplitude: actionMenuSwellOpen ? ACTION_MENU_AMPLITUDE : 0,
              hoverAmplitude: ACTION_MENU_AMPLITUDE,
              magnetizable: false,
            },
          ]
        : [],
    [actionMenuSwellOpen, actionMenuWidth, showActionMenu]
  )

  const scrollFadeClass =
    editingField === 'content'
      ? undefined
      : canScrollUp && canScrollDown
        ? styles.fadeBoth
        : canScrollUp
          ? styles.fadeTop
          : canScrollDown
            ? styles.fadeBottom
            : undefined

  return (
    <div
      ref={noteLayoutRef}
      data-note-layout=''
      className={styles.layout}
      style={{ width: BLOCK_DIMENSIONS.NOTE_WIDTH, height: layoutHeight }}
    >
      <div
        ref={actionMenuRootRef}
        className={styles.group}
        data-action-menu-ready={actionMenuContentVisible ? '' : undefined}
        data-node-selected={hasVisualFocus ? '' : undefined}
        data-note-expanded={isExpanded ? '' : undefined}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
      >
        {showActionMenu && (
          <>
            <div
              aria-hidden='true'
              data-workflow-action-bar-bridge=''
              className={styles.actionBridge}
            />
            <div
              ref={actionMenuHostRef}
              onFocusCapture={handleActionMenuFocus}
              onBlurCapture={handleActionMenuBlur}
            >
              {actionBar}
            </div>
          </>
        )}
        <div
          data-note-card=''
          role={isInlineEditable ? undefined : 'button'}
          tabIndex={isInlineEditable ? -1 : 0}
          className={cn(
            styles.card,
            isExpanded
              ? cn('nodrag', styles.cardExpanded)
              : cn('note-drag-handle', hasVisualFocus ? styles.cardFocused : styles.cardIdle),
            ink.text
          )}
          /* Width and height come from the same constants that size the border
             SVG and the node's canvas bounds — a literal here would move the
             painted card without moving either of those. */
          style={{ width: blockWidth, height: blockHeight }}
          onPointerDown={recordNotePointerStart}
          onClick={handleNoteClick}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
          /* Only the card's own transition. React bubbles this, and the card
             holds several transitioning children (the expand button, both
             icons), so an unguarded handler forces a sync layout read on every
             hover. */
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return
            updateScrollFades()
            /* Only the size transitions, never the card's own colour one: a
               re-scroll on every hover tint would yank a note the user has
               scrolled by hand back onto the mark. */
            const isResize = event.propertyName === 'height' || event.propertyName === 'width'
            if (isResize && searchQuery !== undefined) scrollActiveMatchIntoView()
          }}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget) {
              handleKeyboardActivation(event, () => {
                if (hasVisualFocus && !isExpanded && canEdit && onExpandedChange) {
                  onExpandedChange(true)
                  return
                }
                onSelect()
              })
            }
          }}
        >
          <WorkflowBlockBorder
            ports={borderPorts}
            cursorSwellEnabled={false}
            hasRing={hasRing}
            ring={ring}
            /* A file held over the card lights its own silhouette rather than a
               second, drop-only outline — the card already has one way of
               saying "this is the thing you are acting on". */
            isSelected={hasVisualFocus || isFileDropTarget}
            selectedSilhouetteColor={colorOption.selectedSilhouetteColor}
            silhouetteColorOverride={
              !hasVisualFocus && isHovered ? colorOption.hoverSilhouetteColor : undefined
            }
            bodyFill={colorOption.fill}
            width={blockWidth}
            initialHeight={blockHeight}
            onActionMenuReadyChange={setActionMenuSwellReady}
          />

          <div className={styles.header}>
            <div className={styles.titleWrap}>
              {editingField === 'title' ? (
                <input
                  ref={titleInputRef}
                  aria-label='Note title'
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={finishTitleEditing}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      finishTitleEditing()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelTitleEditing()
                    }
                  }}
                  className={cn(
                    'nodrag nopan nowheel',
                    styles.titleInput,
                    ink.selection,
                    !isEnabled && styles.dimmed
                  )}
                />
              ) : isInlineEditable ? (
                <button
                  type='button'
                  aria-label='Edit note title'
                  onPointerDown={(event) => recordEditPointerStart(event, 'title')}
                  onClick={(event) => startEditing(event, 'title')}
                  className={cn(styles.titleButton, !isEnabled && styles.dimmed)}
                >
                  <OverflowSpan value={name ?? ''} className={styles.title}>
                    {renderMarkedName(name ?? '', nameSearchRange)}
                  </OverflowSpan>
                </button>
              ) : (
                <OverflowSpan
                  value={name ?? ''}
                  className={cn(styles.title, !isEnabled && styles.dimmed)}
                >
                  {renderMarkedName(name ?? '', nameSearchRange)}
                </OverflowSpan>
              )}
            </div>
            {canEdit && onExpandedChange && (
              <CanvasTooltip content={isExpanded ? 'Collapse note' : 'Expand note'}>
                <button
                  type='button'
                  aria-label={isExpanded ? 'Collapse note' : 'Expand note'}
                  aria-pressed={isExpanded}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onExpandedChange(!isExpanded)
                  }}
                  className={cn('nodrag nopan nowheel', styles.expandButton)}
                >
                  <span className={styles.expandGlyphs}>
                    <Expand
                      className={cn(
                        styles.expandGlyph,
                        isExpanded ? styles.glyphHidden : styles.glyphShown
                      )}
                    />
                    <ChevronsDownUp
                      className={cn(
                        styles.expandGlyph,
                        isExpanded ? styles.glyphShown : styles.glyphHidden
                      )}
                    />
                  </span>
                </button>
              </CanvasTooltip>
            )}
          </div>

          <div
            ref={setScrollRegion}
            data-note-scroll-region=''
            role='region'
            aria-label={`${name || 'Note'} content`}
            tabIndex={hasVisualFocus && !canEdit && !isEmpty ? 0 : -1}
            onScroll={updateScrollFades}
            className={cn(
              styles.scrollRegion,
              isContentScrollable &&
                editingField !== 'content' &&
                cn('nowheel allow-scroll', styles.touchScroll),
              !isEmpty && editingField !== 'content' && styles.scrollY,
              editingField === 'content' &&
                cn('nowheel allow-scroll', styles.touchScroll, styles.scrollY),
              scrollFadeClass,
              !isEnabled && styles.dimmed
            )}
          >
            {editingField === 'content' ? (
              <div
                /* The card is `select-none` so dragging it around the canvas
                   never highlights its text. Editing has to opt back in, or the
                   caret is all you get — no word double-click, no drag-select,
                   and so nothing the formatting bar can act on. The title input
                   opts back in the same way. */
                className={cn('nodrag nopan nowheel', styles.editorHost)}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                /* Leaving edit mode is the card's concern, not the injected
                   editor's — so the editor stays a plain value surface. Escape
                   is only honoured when nothing already consumed it: the
                   editor's menus preventDefault it to close themselves, and
                   that must not also close the note. */
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || event.defaultPrevented) return
                  event.preventDefault()
                  setEditingField(null)
                }}
                /* Focus moving inside the editor is not an exit — and neither is
                   focus moving into the editor's own floating UI, which portals
                   outside the canvas, so only a move that stays inside the canvas
                   ends editing. */
                onBlur={(event) => {
                  /* Leaving the browser is not a decision to stop editing, and
                     treating it as one is what made "drag an image in from
                     Finder" impossible: picking the file up blurred the window,
                     which closed the editor before the drop could land. A window
                     blur and a click on non-focusable chrome both arrive with a
                     null `relatedTarget`; whether the document still holds focus
                     is what separates them. */
                  if (event.relatedTarget === null && !document.hasFocus()) return
                  const nextFocus = event.relatedTarget
                  if (nextFocus instanceof Element && !nextFocus.closest('.react-flow')) return
                  if (!event.currentTarget.contains(nextFocus)) setEditingField(null)
                }}
              >
                {renderContentEditor({
                  value: draftContent,
                  selectionClassName: ink.selection,
                  caretClassName: ink.caret,
                  openedAt: contentEditOpenedAt,
                  onChange: (nextContent) => {
                    setDraftContent(nextContent)
                    onContentChange?.(nextContent)
                  },
                })}
              </div>
            ) : (
              <>
                {isInlineEditable && (
                  <button
                    type='button'
                    aria-label='Edit note content'
                    onPointerDown={(event) => recordEditPointerStart(event, 'content')}
                    onClick={(event) => startEditing(event, 'content')}
                    className={styles.editOverlay}
                  />
                )}
                <div
                  ref={contentMeasureRef}
                  className={cn(styles.measure, !isExpanded && styles.measureCompact)}
                >
                  {isEmpty ? (
                    <p className={cn(styles.placeholder, ink.placeholder)}>Add note…</p>
                  ) : (
                    <NoteSearchActiveIndexContext.Provider value={searchOccurrenceIndex ?? null}>
                      <NoteMarkdown content={content} searchQuery={searchQuery} />
                    </NoteSearchActiveIndexContext.Provider>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface NoteBlockNodeData extends WorkflowBlockProps {}

type NoteBlockNode = Node<NoteBlockNodeData, 'noteBlock'>

/**
 * Lazy for the same reason every other consumer of the markdown field is: it
 * carries TipTap and the full extension set, and a Note only mounts it once the
 * user clicks into the body. A static import would put all of that in the
 * canvas's initial chunk, which every workflow pays for.
 */
const NoteMarkdownEditor = dynamic(
  () =>
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/note-block/note-markdown-editor'
    ).then((m) => m.NoteMarkdownEditor),
  { ssr: false, loading: () => <div className={styles.editorHost} /> }
)

const NOTE_EXPAND_FOCUS_DURATION_MS = 300

/** The markdown body's sub-block id, as declared by the Note block config. */
const NOTE_CONTENT_SUBBLOCK_ID = 'content'

function renderNoteContentEditor({
  value,
  selectionClassName,
  caretClassName,
  openedAt,
  onChange,
}: NoteContentEditorProps) {
  return (
    <NoteMarkdownEditor
      value={value}
      selectionClassName={selectionClassName}
      caretClassName={caretClassName}
      openedAt={openedAt}
      onChange={onChange}
    />
  )
}

/**
 * Editor container for the canvas Note.
 *
 * Resolves the note's markdown content from its subblock value, the enabled/ring
 * visual state from {@link useBlockVisual}, and edit permission, then publishes
 * deterministic dimensions and renders the legacy Note pixels — injecting the
 * editor-only {@link ActionBar}.
 */
export const NoteBlock = memo(function NoteBlock({ id, data, selected }: NodeProps<NoteBlockNode>) {
  const { type, name } = data
  const focusFrameRef = useRef<number | null>(null)
  const { getInternalNode, getViewport, setCenter } = useReactFlow()

  const { activeWorkflowId, isEnabled, hasRing, ring } = useBlockVisual({
    blockId: id,
    data,
    isSelected: selected,
  })
  const { collaborativeSetSubblockValue, collaborativeUpdateBlockName } = useCollaborativeWorkflow()
  const storedValues = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return undefined
        return state.workflowValues[activeWorkflowId]?.[id]
      },
      [activeWorkflowId, id]
    )
  )

  const content = useMemo(() => {
    if (data.isPreview && data.subBlockValues) {
      const extractedContent = getNoteStringValue(data.subBlockValues.content)
      return typeof extractedContent === 'string' ? extractedContent : ''
    }
    const storedContent = getNoteStringValue(storedValues?.content)
    return typeof storedContent === 'string' ? storedContent : ''
  }, [data.isPreview, data.subBlockValues, storedValues])

  const rawColor = data.isPreview
    ? getNoteStringValue(data.subBlockValues?.color)
    : getNoteStringValue(storedValues?.color)
  const noteColor = isNoteColor(rawColor) ? rawColor : DEFAULT_NOTE_COLOR

  const userPermissions = useUserPermissionsContext()
  const isWorkflowRunning = useIsCurrentWorkflowExecuting()
  const canEditWorkflow = userPermissions.canEdit && !data.isWorkflowLocked
  const isProtected = useWorkflowStore(
    useCallback((state) => isWorkflowBlockProtected(id, state.blocks), [id])
  )
  const clearCurrentBlock = usePanelEditorStore((state) => state.clearCurrentBlock)
  /* Flattened to primitives under a shallow compare, never held as the target
     object: the search panel re-publishes an equal target on most of its own
     renders, and a card that subscribes to the object rebuilds its highlight on
     every one of them. */
  const searchTarget = usePanelEditorSearchStore(
    useShallow((state) => {
      const target = state.activeSearchTarget
      return {
        blockId: target?.blockId ?? null,
        subBlockId: target?.subBlockId ?? null,
        targetKind: target?.targetKind ?? null,
        query: target?.query ?? null,
        rawValue: target?.rawValue ?? null,
        rangeStart: target?.range?.start ?? null,
        rangeEnd: target?.range?.end ?? null,
      }
    })
  )
  const canEditNote = canEditWorkflow && !data.isPreview && !isProtected

  /** Whether the active search match belongs to this card at all. */
  const isSearchTargetBlock =
    !data.isPreview &&
    !data.isEmbedded &&
    searchTarget.blockId === id &&
    Boolean(searchTarget.query)

  /**
   * The workflow search match this card should paint in its body.
   *
   * The panel editor renders nothing for a note, so the card is the only
   * surface that can answer a search — without this a note match counts towards
   * "1 of 6" and then highlights nowhere.
   *
   * The stored range is re-checked against the live content before it is
   * trusted: the index runs over a snapshot, and a collaborator's edit between
   * indexing and painting would shift the ordinal onto the wrong words. When it
   * no longer holds — or the match never carried one — this falls back to the
   * first rendered occurrence, which is the same fallback the editor panel
   * makes for a label whose stored range does not fit.
   */
  const searchHighlight = useMemo<NoteSearchHighlight | null>(() => {
    if (!isSearchTargetBlock) return null
    if (searchTarget.targetKind !== 'subblock') return null
    if (searchTarget.subBlockId !== NOTE_CONTENT_SUBBLOCK_ID) return null

    const { query, rawValue, rangeStart, rangeEnd } = searchTarget
    if (!query) return null

    const rangeHolds =
      rangeStart !== null && rangeEnd !== null && content.slice(rangeStart, rangeEnd) === rawValue
    if (rangeHolds) {
      return {
        query,
        occurrenceIndex: countNoteSearchOccurrencesBefore(content, query, rangeStart),
      }
    }

    /* Asked through the same scan that will do the marking, rather than a local
       `includes`: a bare comparison skips the whitespace fold, so a query the
       indexer matched across a newline or a non-breaking space would read as
       absent here and the card would paint nothing while the panel counted it. */
    let occurs = false
    forEachNoteSourceOccurrence(content, query, () => {
      occurs = true
    })
    return occurs ? { query, occurrenceIndex: 0 } : null
  }, [content, isSearchTargetBlock, searchTarget])

  /**
   * The match to paint in the title, for a search that hit the note's name.
   *
   * A name match carries an exact range over `block.name`, so unlike the body
   * there is no occurrence to reconstruct — it is used directly, once it still
   * describes the live name.
   */
  const nameSearchRange = useMemo<NoteSearchRange | null>(() => {
    if (!isSearchTargetBlock) return null
    if (searchTarget.targetKind !== 'block-name') return null

    const { rawValue, rangeStart, rangeEnd } = searchTarget
    if (rangeStart === null || rangeEnd === null) return null
    if ((name ?? '').slice(rangeStart, rangeEnd) !== rawValue) return null

    return { start: rangeStart, end: rangeEnd }
  }, [isSearchTargetBlock, name, searchTarget])
  const uploadNoteImage = useNoteImageUpload()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [blockHeight, setBlockHeight] = useState(() => estimateNoteBlockHeight(content))
  const [isExpanded, setIsExpanded] = useState(false)
  const [externalContentWrites, setExternalContentWrites] = useState(0)
  const [renameRequests, setRenameRequests] = useState(0)
  const isFocused = selected

  /* Collapsed during render rather than in an effect: losing edit rights while
     expanded would otherwise paint one frame of an expanded-but-uneditable
     note before the effect corrected it. Seeded with the live value so a note
     that mounts uneditable does not reset anything it has not opened. */
  const [prevCanEditNote, setPrevCanEditNote] = useState(canEditNote)
  if (prevCanEditNote !== canEditNote) {
    setPrevCanEditNote(canEditNote)
    if (!canEditNote) setIsExpanded(false)
  }

  useEffect(
    () => () => {
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    },
    []
  )

  const isExpandedRef = useRef(isExpanded)
  useEffect(() => {
    isExpandedRef.current = isExpanded
  }, [isExpanded])

  /**
   * Opens the card while it holds the current search match, and closes it again
   * when the match moves on.
   *
   * A compact note shows a few lines of what is often a long document, so a
   * match found deep inside it lands in a body the user cannot read. Expanding
   * is the same gesture a click makes, and it gives the mark somewhere to be.
   *
   * Two things this deliberately does not do. It does not call
   * {@link handleExpandedChange}, whose own `setCenter` would race the camera
   * the canvas already moved for this match. And it only closes a card it
   * opened — a note the user expanded by hand, or collapsed by hand while the
   * match still points here, is left exactly as they left it.
   */
  const searchExpandedRef = useRef(false)
  const hasSearchMatch = searchHighlight !== null || nameSearchRange !== null
  useEffect(() => {
    /* Losing edit rights already force-collapses the card during render. Drop the latch with it,
       or regaining them would hit the early return below and leave a deep match clipped in the
       compact body until the active match moved. */
    if (!canEditNote) {
      searchExpandedRef.current = false
      return
    }

    if (hasSearchMatch) {
      if (searchExpandedRef.current || isExpandedRef.current) return
      searchExpandedRef.current = true
      setIsExpanded(true)
      return
    }

    if (!searchExpandedRef.current) return
    searchExpandedRef.current = false
    setIsExpanded(false)
  }, [canEditNote, hasSearchMatch])

  const handleNameChange = (nextName: string) => {
    if (!canEditNote) return false
    return collaborativeUpdateBlockName(id, nextName).success
  }

  const handleContentChange = (nextContent: string) => {
    if (!canEditNote) return
    collaborativeSetSubblockValue(id, NOTE_CONTENT_SUBBLOCK_ID, nextContent)
  }

  /**
   * "Add image" from the canvas context menu. The picker, the upload and the
   * write all live here because the note's content is the thing being changed —
   * the editor may not even be mounted, and routing through it would mean
   * opening one just to insert.
   */
  useEffect(() => {
    if (!canEditNote) return
    const handleAddImage = (event: Event) => {
      const detail = (event as CustomEvent<NoteBlockRequestDetail>).detail
      if (detail?.blockId !== id) return
      imageInputRef.current?.click()
    }
    window.addEventListener(NOTE_ADD_IMAGE_EVENT, handleAddImage)
    return () => window.removeEventListener(NOTE_ADD_IMAGE_EVENT, handleAddImage)
  }, [canEditNote, id])

  /**
   * Uploads then appends, one image at a time so a multi-file pick or drop lands
   * in order. Each write goes to the store rather than to a mounted editor, so
   * it counts as an external one: bumping `externalContentWrites` hands the
   * document back to `content` first, or an open editor's next keystroke would
   * serialize its own stale document over the appended image.
   *
   * Shared by both surfaces that reach the note from outside its editor: the
   * context menu's "Add image" and a file dropped onto the card.
   */
  const insertImages = async (files: File[]) => {
    for (const file of files) {
      const image = await uploadNoteImage(file)
      if (!image) continue
      /* Re-read per image: each append has to build on the previous one, and on
         anything a collaborator wrote while the upload was in flight. */
      const current =
        getNoteStringValue(useSubBlockStore.getState().getValue(id, NOTE_CONTENT_SUBBLOCK_ID)) ?? ''
      setExternalContentWrites((count) => count + 1)
      collaborativeSetSubblockValue(
        id,
        NOTE_CONTENT_SUBBLOCK_ID,
        appendNoteImageMarkdown(current, image)
      )
    }
  }

  const handleColorChange = useCallback(
    (color: NoteColor) => {
      if (!canEditNote) return
      collaborativeSetSubblockValue(id, 'color', color)
    },
    [canEditNote, collaborativeSetSubblockValue, id]
  )

  const handleNoteSelect = useCallback(() => {
    if (data.isPreview || data.isEmbedded) return
    clearCurrentBlock()
  }, [clearCurrentBlock, data.isEmbedded, data.isPreview])

  const handleExpandedChange = useCallback(
    (expanded: boolean) => {
      if (expanded && !canEditNote) return
      if (expanded) handleNoteSelect()
      setIsExpanded(expanded)

      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
      if (!expanded) return

      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = requestAnimationFrame(() => {
          focusFrameRef.current = null
          const position = getInternalNode(id)?.internals.positionAbsolute
          if (!position) return
          void setCenter(
            position.x + BLOCK_DIMENSIONS.NOTE_WIDTH / 2,
            position.y + blockHeight / 2,
            {
              zoom: getViewport().zoom,
              duration: NOTE_EXPAND_FOCUS_DURATION_MS,
            }
          )
        })
      })
    },
    [blockHeight, canEditNote, getInternalNode, getViewport, handleNoteSelect, id, setCenter]
  )

  /**
   * "Rename" from the canvas context menu. The panel editor is not an option —
   * it clears any note put in front of it and renders nothing — so the card's
   * own title is the rename surface. That title is only reachable once the card
   * is expanded, which is why this expands first and asks second.
   */
  useEffect(() => {
    if (!canEditNote) return
    const handleRename = (event: Event) => {
      const detail = (event as CustomEvent<NoteBlockRequestDetail>).detail
      if (detail?.blockId !== id) return
      handleExpandedChange(true)
      setRenameRequests((count) => count + 1)
    }
    window.addEventListener(NOTE_RENAME_EVENT, handleRename)
    return () => window.removeEventListener(NOTE_RENAME_EVENT, handleRename)
  }, [canEditNote, handleExpandedChange, id])

  /**
   * Calculate deterministic dimensions based on content structure. Uses fixed
   * width and computed height to avoid ResizeObserver jitter.
   */
  useBlockDimensions({
    blockId: id,
    calculateDimensions: () => {
      return {
        width: BLOCK_DIMENSIONS.NOTE_WIDTH,
        height: blockHeight,
      }
    },
    dependencies: [blockHeight],
  })

  return (
    <>
      <input
        ref={imageInputRef}
        type='file'
        accept='image/*'
        multiple
        hidden
        onChange={(event) => {
          const input = event.currentTarget
          const images = Array.from(input.files ?? []).filter((file) =>
            file.type.startsWith('image/')
          )
          input.value = ''
          if (images.length > 0) void insertImages(images)
        }}
      />
      <NoteBlockView
        name={name}
        content={content}
        noteColor={noteColor}
        isEnabled={isEnabled}
        isFocused={isFocused}
        isExpanded={isExpanded}
        canEdit={canEditNote}
        hasRing={hasRing}
        ring={ring}
        onSelect={handleNoteSelect}
        onNameChange={handleNameChange}
        onContentChange={handleContentChange}
        externalContentWrites={externalContentWrites}
        externalRenameRequests={renameRequests}
        onHeightChange={setBlockHeight}
        onExpandedChange={handleExpandedChange}
        onImageFilesDrop={(files) => void insertImages(files)}
        renderContentEditor={renderNoteContentEditor}
        searchHighlight={searchHighlight}
        nameSearchRange={nameSearchRange}
        actionBar={
          <ActionBar
            blockId={id}
            blockType={type}
            disabled={!canEditWorkflow}
            variant='swell'
            isWorkflowRunning={isWorkflowRunning}
            noteColor={noteColor}
            onNoteColorChange={handleColorChange}
            onNoteColorMenuOpen={handleNoteSelect}
          />
        }
      />
    </>
  )
})
