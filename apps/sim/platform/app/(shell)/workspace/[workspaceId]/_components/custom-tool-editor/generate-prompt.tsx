'use client'

import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-editor.module.css'

interface GeneratePromptProps {
  isLoading: boolean
  isStreaming: boolean
  onSubmit: (prompt: string) => void
}

/**
 * Generate, above a custom tool's editor: a quiet action that swaps into an inline prompt and
 * hands the trimmed prompt to the editor's AI stream.
 */
export function GeneratePrompt({ isLoading, isStreaming, onSubmit }: GeneratePromptProps) {
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
    <span className={styles.generate}>
      <input
        ref={inputRef}
        className={styles.generateInput}
        data-type='T060'
        aria-label='Describe what to generate'
        placeholder='Describe what to generate...'
        value={isStreaming ? 'Generating...' : prompt}
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
