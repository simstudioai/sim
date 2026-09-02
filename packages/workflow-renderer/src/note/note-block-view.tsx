import {
  type ComponentProps,
  createContext,
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
import { ChevronsDownUp, Expand } from '@sim/emcn/icons'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown'
import 'streamdown/styles.css'
import { Button, cn, handleKeyboardActivation, Tooltip } from '@sim/emcn'
import { getEmbedInfo } from '@sim/utils/media-embed'
import { BLOCK_DIMENSIONS, clampNoteBlockHeight, estimateNoteBlockHeight } from '../dimensions'
import { OverflowSpan } from '../lib/overflow-span'
import { useActionMenuSwell } from '../workflow-block/use-action-menu-swell'
import {
  WorkflowBlockBorder,
  type WorkflowBorderPort,
} from '../workflow-block/workflow-block-border'
import { DEFAULT_NOTE_COLOR, getNoteColorOption, type NoteColor } from './note-colors'
import {
  type NoteSearchHighlight,
  type NoteSearchRange,
  noteSearchHighlightPlugin,
} from './note-search-highlight'

const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`
const ACTION_MENU_RIGHT_INSET_PX = 24
const ACTION_MENU_AMPLITUDE = 7
const EDIT_CLICK_TOLERANCE_PX = 4

type NoteEditingField = 'title' | 'content' | null

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
 * Checkbox chrome for a GFM task item, matching the editor's own
 * (`.rich-markdown-nodes input[type="checkbox"]`) declaration for declaration —
 * including the tick's clip-path — because the two render the same note either
 * side of a click and any difference reads as the card changing shape.
 *
 * `disabled` is what remark-gfm emits and what the read view wants: the note is
 * not interactive until you click into it, and then the editor owns the control.
 */
const NOTE_TASK_CHECKBOX_CLASS = [
  'mt-[3px] inline-grid size-[16px] shrink-0 appearance-none place-content-center',
  'rounded-[3px] border border-[var(--border-1)] bg-transparent',
  'checked:border-[var(--text-primary)] checked:bg-[var(--text-primary)]',
  "checked:after:size-[10px] checked:after:bg-[var(--surface-2)] checked:after:content-['']",
  'checked:after:[clip-path:polygon(14%_44%,0_65%,50%_100%,100%_16%,80%_0%,43%_62%)]',
].join(' ')

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

/*
 * A note paints its own card fill, so the editor panel's fixed orange cannot
 * simply be reused: it disappears against a light card and fights the white
 * text on a dark one. Other matches wash the card's own colour, and the current
 * one paints both fill and text so it reads on every colour in the palette.
 */
const NOTE_SEARCH_MARK_CLASS = 'rounded-sm bg-current/20 text-inherit'
const NOTE_SEARCH_ACTIVE_MARK_CLASS = 'rounded-sm bg-orange-400 text-black'

interface NoteSearchMarkProps {
  children?: ReactNode
  'data-note-search-index'?: string
}

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
      className={isActive ? NOTE_SEARCH_ACTIVE_MARK_CLASS : NOTE_SEARCH_MARK_CLASS}
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
      <mark data-note-search-active='' className={NOTE_SEARCH_ACTIVE_MARK_CLASS}>
        {name.slice(range.start, range.end)}
      </mark>
      {name.slice(range.end)}
    </>
  )
}

const NOTE_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className='mb-1 break-words text-current text-sm leading-[1.25rem] last:mb-0'>{children}</p>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className='mt-3 mb-3 break-words font-semibold text-current text-lg first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className='mt-2.5 mb-2.5 break-words font-semibold text-base text-current first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className='mt-2 mb-2 break-words font-semibold text-current text-sm first:mt-0'>
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h4 className='mt-2 mb-2 break-words font-semibold text-current text-xs first:mt-0'>
      {children}
    </h4>
  ),
  /* A checklist is not a bulleted list: remark-gfm marks it `contains-task-list`,
     and the disc and left padding have to come off or every checkbox sits behind
     a bullet. Same rule the editor's shared node chrome applies. */
  ul: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <ul
      className={cn(
        'mt-1 mb-1 space-y-1 break-words text-current text-sm',
        className?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc pl-6'
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className='mt-1 mb-1 list-decimal space-y-1 break-words pl-6 text-current text-sm'>
      {children}
    </ol>
  ),
  li: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <li
      className={cn(
        'break-words',
        className?.includes('task-list-item') && 'flex items-start gap-2'
      )}
    >
      {children}
    </li>
  ),
  input: ({ type, checked }: ComponentProps<'input'>) =>
    type === 'checkbox' ? (
      <input type='checkbox' checked={checked} disabled className={NOTE_TASK_CHECKBOX_CLASS} />
    ) : null,
  /**
   * `width`/`height` are load-bearing, not decoration: resizing an image in the editor commits the
   * new width to the node and it serializes as `<img width>`, since markdown has no size syntax.
   * Dropping them here rendered every image at its natural size in the read view, so a resized note
   * flipped between two sizes as editing opened and closed.
   *
   * `h-auto` keeps the aspect ratio when `max-w-full` shrinks a wide image below its stated width —
   * the same pairing the editor's node view uses, so both views agree at every card width.
   */
  img: ({ src, alt, width, height }: ComponentProps<'img'>) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      width={width}
      height={height}
      className='my-2 block h-auto max-w-full rounded-md'
    />
  ),
  inlineCode: ({ children }: { children?: ReactNode }) => (
    <code className='whitespace-normal rounded bg-black/10 px-1 py-0.5 font-mono text-current text-xs'>
      {children}
    </code>
  ),
  code: ({ children, className, ...props }: { children?: ReactNode; className?: string }) => (
    <code
      {...props}
      className='block whitespace-pre-wrap break-words rounded bg-black/15 p-2 text-current text-xs'
    >
      {children}
    </code>
  ),
  a: ({ href, children }: { href?: string; children?: ReactNode }) => {
    const embedInfo = href ? getEmbedInfo(href) : null
    if (embedInfo) {
      return (
        <span className='my-2 block w-full'>
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            className='mb-1 block break-all font-medium text-current underline underline-offset-2 opacity-90 hover-hover:opacity-100'
          >
            {children}
          </a>
          <span className='block w-full overflow-hidden rounded-md'>
            {embedInfo.type === 'iframe' && (
              <span
                className='block overflow-hidden'
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
                  className='origin-top-left'
                  style={{
                    width: EMBED_INVERSE_SCALE,
                    height: EMBED_INVERSE_SCALE,
                    transform: `scale(${EMBED_SCALE})`,
                  }}
                />
              </span>
            )}
            {embedInfo.type === 'video' && (
              <video
                src={embedInfo.url}
                controls
                preload='metadata'
                className='aspect-video w-full'
              >
                <track kind='captions' src='' default />
              </video>
            )}
            {embedInfo.type === 'audio' && (
              <audio src={embedInfo.url} controls preload='metadata' className='w-full'>
                <track kind='captions' src='' default />
              </audio>
            )}
          </span>
        </span>
      )
    }
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='break-all font-medium text-current underline underline-offset-2 opacity-90 hover-hover:opacity-100'
      >
        {children}
      </a>
    )
  },
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className='break-words font-semibold text-current'>{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className='break-words text-current opacity-80'>{children}</em>
  ),
  mark: NoteSearchMark,
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className='my-4 break-words border-current/25 border-l-2 pl-4 text-current italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className='my-2 max-w-full overflow-x-auto'>
      <table className='w-full border-collapse text-xs'>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className='border-current/20 border-b'>{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className='border-current/20 border-b last:border-b-0'>{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className='px-2 py-1 text-left font-semibold text-current'>{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className='px-2 py-1 text-current opacity-90'>{children}</td>
  ),
}

/**
 * Block rhythm for the note's markdown, and the contract the inline editor
 * mirrors on its ProseMirror root.
 *
 * Streamdown wraps its output in a container that applies exactly this by
 * default, which outranks the per-element margins in {@link NOTE_COMPONENTS} —
 * so it, not those margins, is what the read view actually paints. Passing it
 * explicitly makes the rule the note's own: a Streamdown upgrade can no longer
 * move the read view out from under the editor, which is what made every block
 * after the first jump the moment editing opened.
 */
export const NOTE_MARKDOWN_FLOW = 'space-y-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'

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
      className={NOTE_MARKDOWN_FLOW}
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
export interface NoteBlockViewProps {
  name?: string
  /** Markdown content; an empty string renders the placeholder. */
  content: string
  noteColor?: NoteColor
  isEnabled: boolean
  isFocused: boolean
  isExpanded?: boolean
  canEdit?: boolean
  hasRing: boolean
  ringStyles: string
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
  /**
   * Renders the markdown editor. Required rather than optional: an internal
   * fallback editor would be a second editing surface that production never
   * reaches, drifting from the real one with only tests to notice.
   */
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
export function NoteBlockView({
  name,
  content,
  noteColor = DEFAULT_NOTE_COLOR,
  isEnabled,
  isFocused,
  isExpanded = false,
  canEdit = false,
  hasRing,
  ringStyles,
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
  function handleFileDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!acceptsImageDrop || !isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsFileDropTarget(true)
  }

  function handleFileDragLeave(event: React.DragEvent<HTMLDivElement>) {
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

  function handleFileDrop(event: React.DragEvent<HTMLDivElement>) {
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

  return (
    <div
      ref={noteLayoutRef}
      data-note-layout=''
      className='relative'
      style={{ width: BLOCK_DIMENSIONS.NOTE_WIDTH, height: layoutHeight }}
    >
      <div
        ref={actionMenuRootRef}
        className='group -translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2'
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
              className='-top-[28px] pointer-events-auto absolute inset-x-0 z-10 h-[28px]'
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
            'relative z-20 select-none rounded-2xl transition-[color,width,height] [transition-duration:150ms,280ms,280ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            isExpanded
              ? 'nodrag cursor-default'
              : [
                  'note-drag-handle [&:active]:cursor-grabbing',
                  hasVisualFocus ? 'cursor-text' : 'cursor-grab',
                ],
            colorOption.textClassName
          )}
          /* Width and height come from the same constants that size the border
             SVG and the node's canvas bounds — a Tailwind literal here would
             move the painted card without moving either of those. */
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
            ringStyles={ringStyles}
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

          <div className='relative z-10 flex h-10 items-center justify-between px-2'>
            <div className='flex min-w-0 flex-1 items-center transition-opacity duration-150 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]'>
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
                    'nodrag nopan nowheel h-7 w-full min-w-0 select-text border-none bg-transparent px-0 text-[17px] text-current caret-current outline-hidden focus-visible:outline-hidden',
                    colorOption.selectionClassName,
                    !isEnabled && 'opacity-50'
                  )}
                />
              ) : isInlineEditable ? (
                <button
                  type='button'
                  aria-label='Edit note title'
                  onPointerDown={(event) => recordEditPointerStart(event, 'title')}
                  onClick={(event) => startEditing(event, 'title')}
                  className={cn(
                    'min-w-0 flex-1 cursor-text rounded-sm bg-transparent text-left',
                    !isEnabled && 'opacity-50'
                  )}
                >
                  <OverflowSpan value={name ?? ''} className='text-[17px] text-current'>
                    {renderMarkedName(name ?? '', nameSearchRange)}
                  </OverflowSpan>
                </button>
              ) : (
                <OverflowSpan
                  value={name ?? ''}
                  className={cn('text-[17px] text-current', !isEnabled && 'opacity-50')}
                >
                  {renderMarkedName(name ?? '', nameSearchRange)}
                </OverflowSpan>
              )}
            </div>
            {canEdit && onExpandedChange && (
              <Tooltip.Root preferAbove>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    aria-label={isExpanded ? 'Collapse note' : 'Expand note'}
                    aria-pressed={isExpanded}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onExpandedChange(!isExpanded)
                    }}
                    className='nodrag nopan nowheel pointer-events-none ml-1 size-[24px] shrink-0 rounded-md border-none bg-transparent p-0 text-current opacity-0 transition-[background-color,color,opacity,transform] duration-150 hover-hover:bg-current/10 hover-hover:opacity-100 active:scale-[0.96] group-hover:pointer-events-auto group-hover:opacity-70 group-data-[node-selected]:pointer-events-auto group-data-[node-selected]:opacity-70'
                  >
                    <span className='relative size-[14px]'>
                      <Expand
                        className={cn(
                          'absolute inset-0 size-[14px] transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                          isExpanded
                            ? 'scale-[0.25] opacity-0 blur-[4px]'
                            : 'scale-100 opacity-100 blur-0'
                        )}
                      />
                      <ChevronsDownUp
                        className={cn(
                          'absolute inset-0 size-[14px] transition-[opacity,scale,filter] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                          isExpanded
                            ? 'scale-100 opacity-100 blur-0'
                            : 'scale-[0.25] opacity-0 blur-[4px]'
                        )}
                      />
                    </span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='right'>
                  {isExpanded ? 'Collapse note' : 'Expand note'}
                </Tooltip.Content>
              </Tooltip.Root>
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
              'scrollbar-none relative z-10 h-[calc(100%_-_40px)] max-w-full overflow-x-hidden break-words px-2 pt-0 pb-0 text-current [contain:layout]',
              isContentScrollable &&
                editingField !== 'content' &&
                'nowheel allow-scroll touch-pan-y',
              !isEmpty && editingField !== 'content' && 'overflow-y-auto',
              editingField === 'content' && 'nowheel allow-scroll touch-pan-y overflow-y-auto',
              editingField !== 'content' &&
                canScrollUp &&
                canScrollDown && [
                  '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_12px,black_calc(100%_-_12px),transparent_100%)]',
                  '[mask-image:linear-gradient(to_bottom,transparent_0px,black_12px,black_calc(100%_-_12px),transparent_100%)]',
                ],
              editingField !== 'content' &&
                canScrollUp &&
                !canScrollDown && [
                  '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_12px)]',
                  '[mask-image:linear-gradient(to_bottom,transparent_0px,black_12px)]',
                ],
              editingField !== 'content' &&
                !canScrollUp &&
                canScrollDown && [
                  '[-webkit-mask-image:linear-gradient(to_bottom,black_calc(100%_-_12px),transparent_100%)]',
                  '[mask-image:linear-gradient(to_bottom,black_calc(100%_-_12px),transparent_100%)]',
                ],
              !isEnabled && 'opacity-50'
            )}
          >
            {editingField === 'content' ? (
              <div
                /* The card is `select-none` so dragging it around the canvas
                   never highlights its text. Editing has to opt back in, or the
                   caret is all you get — no word double-click, no drag-select,
                   and so nothing the formatting bar can act on. The title input
                   opts back in the same way. */
                className='nodrag nopan nowheel min-h-full w-full select-text'
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                /* Leaving edit mode is the card's concern, not the injected
                   editor's — so the editor stays a plain value surface. Escape
                   is only honoured when nothing already consumed it: the
                   editor's `/` and `@` menus preventDefault it to close
                   themselves, and that must not also close the note. */
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || event.defaultPrevented) return
                  event.preventDefault()
                  setEditingField(null)
                }}
                /* Focus moving inside the editor is not an exit — and neither is
                   focus moving into the editor's own floating UI. The formatting
                   bar, the link editor, the `/` menu and a code block's language
                   menu all portal to the document body, outside the canvas, so
                   only a move that stays inside the canvas ends editing. */
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
                  selectionClassName: colorOption.selectionClassName,
                  caretClassName: colorOption.caretClassName,
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
                    className='absolute inset-0 z-20 w-full cursor-text rounded-sm bg-transparent'
                  />
                )}
                <div
                  ref={contentMeasureRef}
                  className={cn(
                    'relative max-w-full pt-0.5 pb-2',
                    !isExpanded && 'pointer-events-none'
                  )}
                >
                  {isEmpty ? (
                    <p className={cn('text-sm', colorOption.placeholderClassName)}>Add note…</p>
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
