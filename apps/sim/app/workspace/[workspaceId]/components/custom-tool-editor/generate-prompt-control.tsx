'use client'

import { useRef, useState } from 'react'
import { Chip, ChipInput } from '@sim/emcn'
import { ArrowUp } from 'lucide-react'

interface GeneratePromptControlProps {
  isLoading: boolean
  isStreaming: boolean
  onSubmit: (prompt: string) => void
}

/**
 * The "Generate" affordance above a custom-tool editor: a chip that swaps into
 * an inline prompt field, then hands the trimmed prompt to the caller's wand
 * stream. Owns only its own transient input state so both the schema and code
 * fields can reuse it.
 */
export function GeneratePromptControl({
  isLoading,
  isStreaming,
  onSubmit,
}: GeneratePromptControlProps) {
  const [isActive, setIsActive] = useState(false)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const activate = () => {
    if (isLoading || isStreaming) return
    setIsActive(true)
    setPrompt('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const submit = () => {
    const trimmed = prompt.trim()
    if (!trimmed || isLoading || isStreaming) return
    onSubmit(trimmed)
    setPrompt('')
    setIsActive(false)
  }

  if (!isActive) {
    return (
      <Chip flush onClick={activate} disabled={isLoading || isStreaming}>
        Generate
      </Chip>
    )
  }

  return (
    <div className='flex items-center gap-1'>
      <ChipInput
        ref={inputRef}
        value={isStreaming ? 'Generating...' : prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => {
          if (!prompt.trim() && !isStreaming) setIsActive(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setPrompt('')
            setIsActive(false)
          }
        }}
        disabled={isStreaming}
        className='w-[220px]'
        placeholder='Describe what to generate...'
      />
      <Chip
        flush
        leftIcon={ArrowUp}
        aria-label='Generate'
        disabled={!prompt.trim() || isStreaming}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          submit()
        }}
      />
    </div>
  )
}
