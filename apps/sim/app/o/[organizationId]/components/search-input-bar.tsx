import {
  type ClipboardEventHandler,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { PROMPT_TEXT_CLASSES } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import { GrowingTextarea } from '@/app/workspace/[workspaceId]/home/components/user-input/components/growing-textarea'
import { InputToolbar } from '@/app/workspace/[workspaceId]/home/components/user-input/components/input-toolbar'

interface SearchInputBarProps {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
  placeholder?: string
  'aria-label'?: string
  leadingControls?: ReactNode
  trailingControls: ReactNode
  floating?: boolean
}

/** Canonical Search bar shared by raw search and conversational Search. */
export function SearchInputBar({
  leadingControls,
  inputRef,
  value,
  onChange,
  onSubmit,
  onPaste,
  placeholder = 'Search your sources',
  'aria-label': ariaLabel = 'Search your sources',
  trailingControls,
  floating = false,
}: SearchInputBarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const leadingRef = useRef<HTMLDivElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  const textMeasureRef = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(value.includes('\n'))

  /** Measure against the compact width so expanding the field cannot cause a wrap/collapse loop. */
  useLayoutEffect(() => {
    const bar = scrollerRef.current
    const leading = leadingRef.current
    const trailing = trailingRef.current
    const text = textMeasureRef.current
    if (!bar || !leading || !trailing || !text) return
    const measure = () => {
      const style = getComputedStyle(bar)
      const compactWidth =
        bar.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight) -
        leading.offsetWidth -
        trailing.offsetWidth -
        Number.parseFloat(getComputedStyle(leading.parentElement!).columnGap) * 2
      setExpanded(
        value.includes('\n') || text.getBoundingClientRect().width > Math.max(0, compactWidth)
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const element of [bar, leading, trailing]) observer.observe(element)
    return () => observer.disconnect()
  }, [value])

  return (
    <div
      ref={scrollerRef}
      className={cn(
        'relative min-h-[46px] w-full rounded-[23px] border border-[var(--border-1)] bg-[var(--white)] py-[7px] pr-2.5 pl-4 dark:bg-[var(--surface-4)]',
        floating && 'shadow-ambient'
      )}
    >
      <InputToolbar
        leadingRef={leadingRef}
        trailingRef={trailingRef}
        leadingControls={
          leadingControls ?? <Search className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        }
        trailingControls={trailingControls}
        expanded={expanded}
        editor={
          <GrowingTextarea
            inputRef={inputRef}
            scrollerRef={scrollerRef}
            value={value}
            compact={!expanded}
            maxHeight={200}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                onSubmit()
              }
            }}
            onPaste={onPaste}
            placeholder={placeholder}
            aria-label={ariaLabel}
            autoComplete='off'
            spellCheck={false}
          />
        }
      />
      <div aria-hidden className='pointer-events-none absolute h-0 w-0 overflow-hidden'>
        <span ref={textMeasureRef} className={cn(PROMPT_TEXT_CLASSES, 'whitespace-pre')}>
          {value}
        </span>
      </div>
    </div>
  )
}
