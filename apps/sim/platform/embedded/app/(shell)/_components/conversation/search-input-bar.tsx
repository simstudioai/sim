import {
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
  useRef,
} from 'react'
import { GrowingTextarea } from '@/components/mothership-chat/user-input/components/growing-textarea'
import { InputToolbar } from '@/components/mothership-chat/user-input/components/input-toolbar'
import styles from '@/platform/embedded/app/(shell)/_components/conversation/page-composer.module.css'

interface SearchInputBarProps {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
  placeholder: string
  'aria-label': string
  leadingControls: ReactNode
  attachments?: ReactNode
  voiceControl?: ReactNode
  submitControl: ReactNode
  fieldClassName?: string
}

/** Assistant's field in the host's frame: plain text, stacked above its controls. */
export function SearchInputBar({
  leadingControls,
  attachments,
  inputRef,
  value,
  onChange,
  onSubmit,
  onPaste,
  onKeyDown,
  placeholder,
  'aria-label': ariaLabel,
  voiceControl,
  submitControl,
  fieldClassName,
}: SearchInputBarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={scrollerRef} className={styles.inputBar}>
      {attachments}
      <InputToolbar
        leadingControls={leadingControls}
        showModelSelector={false}
        voiceControl={voiceControl}
        submitControl={submitControl}
        expanded
        editor={
          <GrowingTextarea
            inputRef={inputRef}
            scrollerRef={scrollerRef}
            value={value}
            className={fieldClassName}
            maxHeight={200}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              onKeyDown?.(event)
              if (event.defaultPrevented) return
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
    </div>
  )
}
