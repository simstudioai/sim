'use client'

import { useEffect, useRef } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/wand-prompt-bar/wand-prompt-bar.module.css'

interface WandPromptBarProps {
  isVisible: boolean
  isLoading: boolean
  isStreaming: boolean
  promptValue: string
  onSubmit: (prompt: string) => void
  onCancel: () => void
  onChange: (value: string) => void
  placeholder?: string
}

/** The AI prompt that floats above a field showing its own Generate action. */
export function WandPromptBar({
  isVisible,
  isLoading,
  isStreaming,
  promptValue,
  onSubmit,
  onCancel,
  onChange,
  placeholder = 'Describe what you want to generate...',
}: WandPromptBarProps) {
  const bar = useRef<HTMLDivElement>(null)
  const busy = isLoading || isStreaming

  useEffect(() => {
    if (!isVisible || busy) return
    const onPointerDown = (event: PointerEvent) => {
      if (bar.current && !bar.current.contains(event.target as Node)) onCancel()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isVisible, busy, onCancel])

  if (!isVisible && !isStreaming) return null

  return (
    <div ref={bar} className={styles.bar} data-material='floating' data-elevation='menu'>
      <input
        className={styles.input}
        data-type='T043'
        aria-label='Generate with AI'
        value={isStreaming ? 'Generating...' : promptValue}
        onChange={(event) => {
          if (!isStreaming) onChange(event.target.value)
        }}
        placeholder={placeholder}
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck={false}
        disabled={busy}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !busy && promptValue.trim()) onSubmit(promptValue)
          else if (event.key === 'Escape' && !busy) onCancel()
        }}
      />
      <IconButton label='Close AI prompt' icon='I105' size='compact' onClick={onCancel} />
      {!isStreaming && (
        <IconButton
          label='Generate content'
          icon='I023'
          size='compact'
          variant='solid'
          disabled={busy || !promptValue.trim()}
          onClick={() => onSubmit(promptValue)}
        />
      )}
    </div>
  )
}

interface WandButtonProps {
  onClick: () => void
  disabled?: boolean
}

/** Opens a field's own AI prompt. */
export function WandButton({ onClick, disabled }: WandButtonProps) {
  return (
    <Button
      variant='quiet'
      size='compact'
      aria-label='Generate content with AI'
      disabled={disabled}
      onClick={onClick}
    >
      Generate
    </Button>
  )
}
