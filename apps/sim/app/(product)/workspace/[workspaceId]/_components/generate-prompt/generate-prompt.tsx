'use client'

import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/generate-prompt/generate-prompt.module.css'

interface GeneratePromptProps {
  /** A generation is starting; Generate waits for it. */
  isLoading: boolean
  isStreaming: boolean
  onSubmit: (prompt: string) => void
  placeholder?: string
}

/**
 * Generate: a quiet action that swaps into an inline prompt and hands the trimmed prompt to an AI
 * stream, as a field's label row and the custom tool editor both offer it.
 */
export function GeneratePrompt({
  isLoading,
  isStreaming,
  onSubmit,
  placeholder = 'Describe what to generate…',
}: GeneratePromptProps) {
  const [active, setActive] = useState(false)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = isLoading || isStreaming

  const submit = () => {
    const trimmed = prompt.trim()
    if (!trimmed || busy) return
    onSubmit(trimmed)
    setPrompt('')
    setActive(false)
  }

  if (!active)
    return (
      <Button
        variant='quiet'
        size='compact'
        disabled={busy}
        onClick={() => {
          setActive(true)
          setPrompt('')
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        Generate
      </Button>
    )

  return (
    <span className={styles.prompt}>
      <input
        ref={inputRef}
        className={styles.input}
        data-type='T060'
        aria-label={placeholder.replace(/\.+$/, '')}
        placeholder={placeholder}
        value={isStreaming ? 'Generating…' : prompt}
        disabled={isStreaming}
        autoComplete='off'
        spellCheck={false}
        onChange={(event) => setPrompt(event.target.value)}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (next instanceof HTMLElement && next.closest('button')) return
          if (!prompt.trim() && !isStreaming) setActive(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setPrompt('')
            setActive(false)
          }
        }}
      />
      <IconButton
        label='Generate'
        icon='I023'
        size='compact'
        variant='solid'
        disabled={!prompt.trim() || isStreaming}
        onClick={submit}
      />
    </span>
  )
}
