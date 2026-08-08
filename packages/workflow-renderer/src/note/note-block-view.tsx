import {
  type ComponentProps,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronsDownUp, Expand } from '@sim/emcn/icons'
import remarkBreaks from 'remark-breaks'
import { Streamdown } from 'streamdown'
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
 * Compact markdown renderer for note blocks with tight spacing
 */
const NOTE_REMARK_PLUGINS = [remarkBreaks]

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
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className='mt-1 mb-1 list-disc space-y-1 break-words pl-6 text-current text-sm'>
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className='mt-1 mb-1 list-decimal space-y-1 break-words pl-6 text-current text-sm'>
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className='break-words'>{children}</li>,
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

const NoteMarkdown = memo(function NoteMarkdown({ content }: { content: string }) {
  return (
    <Streamdown
      mode='static'
      className={NOTE_MARKDOWN_FLOW}
      remarkPlugins={NOTE_REMARK_PLUGINS}
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
   * the canvas "Add image" action is the only one today. Each one ends any
   * in-progress content editing, because the editor seeds its document once when
   * editing opens: left running, its next keystroke would serialize that stale
   * document straight over the host's write.
   */
  externalContentWrites?: number
  /** Publishes the measured, clamped canvas height to the editor container. */
  onHeightChange?: (height: number) => void
  onExpandedChange?: (expanded: boolean) => void
  /**
   * Renders the markdown editor. Required rather than optional: an internal
   * fallback editor would be a second editing surface that production never
   * reaches, drifting from the real one with only tests to notice.
   */
  renderContentEditor: (props: NoteContentEditorProps) => ReactNode
  /** Editor-only action bar; omit in read-only / preview contexts. */
  actionBar?: ReactNode
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
  onHeightChange,
  onExpandedChange,
  renderContentEditor,
  actionBar,
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
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)
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
          /* Only the card's own transition. React bubbles this, and the card
             holds several transitioning children (the expand button, both
             icons), so an unguarded handler forces a sync layout read on every
             hover. */
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget) updateScrollFades()
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
            isSelected={hasVisualFocus}
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
                    'nodrag nopan nowheel h-7 w-full min-w-0 select-text border-none bg-transparent px-0 font-medium text-[17px] text-current caret-current outline-none focus-visible:outline-none',
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
                    'min-w-0 flex-1 cursor-text rounded-sm bg-transparent text-left outline-offset-1 focus-visible:outline-2 focus-visible:outline-current/50',
                    !isEnabled && 'opacity-50'
                  )}
                >
                  <OverflowSpan
                    value={name ?? ''}
                    className='truncate font-medium text-[17px] text-current'
                  />
                </button>
              ) : (
                <OverflowSpan
                  value={name ?? ''}
                  className={cn(
                    'truncate font-medium text-[17px] text-current',
                    !isEnabled && 'opacity-50'
                  )}
                />
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
                    className='absolute inset-0 z-20 w-full cursor-text rounded-sm bg-transparent outline-offset-1 focus-visible:outline-2 focus-visible:outline-current/50'
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
                    <NoteMarkdown content={content} />
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
