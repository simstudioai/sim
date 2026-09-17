import type { RefObject, TextareaHTMLAttributes } from 'react'
import { cn } from '@sim/emcn'
import { TEXTAREA_BASE_CLASSES } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import { useAutoSizeTextarea } from '@/hooks/use-auto-size-textarea'

interface GrowingTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  inputRef: RefObject<HTMLTextAreaElement | null>
  scrollerRef: RefObject<HTMLDivElement | null>
  value: string
  maxHeight?: number
  compact?: boolean
}

/** The common editing surface for Search and Build; hosts add mentions and toolbar layout. */
export function GrowingTextarea({
  inputRef,
  scrollerRef,
  value,
  maxHeight,
  compact = false,
  className,
  ...props
}: GrowingTextareaProps) {
  useAutoSizeTextarea({ textareaRef: inputRef, scrollerRef, value, maxHeight })
  return (
    <textarea
      {...props}
      ref={inputRef}
      value={value}
      rows={1}
      className={cn(TEXTAREA_BASE_CLASSES, compact && 'px-0 py-[3px]', className)}
    />
  )
}
