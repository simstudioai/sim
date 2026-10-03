'use client'

import { useRef, useState } from 'react'
import { SecretInput } from '@sim/emcn'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'

const NO_ENV_VARS = new Set<string>()

interface ConnectorApiKeyInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  workspaceId?: string
}

export function ConnectorApiKeyInput({
  value,
  onChange,
  placeholder,
  workspaceId,
}: ConnectorApiKeyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [showSecrets, setShowSecrets] = useState(false)
  const availableEnvVars = useAvailableEnvVarKeys(workspaceId, { enabled: isFocused })
  const trigger = checkEnvVarTrigger(value, cursorPosition)
  const visible = showSecrets && trigger.show

  return (
    <div className='relative' data-chip-modal-enter-owner={visible ? '' : undefined}>
      <SecretInput
        ref={inputRef}
        value={value}
        onChange={(next) => {
          onChange(next)
          setCursorPosition(inputRef.current?.selectionStart ?? next.length)
          setShowSecrets(true)
        }}
        onSelect={(event) => {
          setCursorPosition(event.currentTarget.selectionStart ?? value.length)
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onScroll={(event) => {
          if (overlayRef.current) {
            overlayRef.current.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`
          }
        }}
        inputClassName={isFocused ? 'text-transparent caret-[var(--text-primary)]' : undefined}
        placeholder={placeholder}
      />
      {isFocused && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2 text-[var(--text-body)] text-sm'
        >
          <div
            ref={(element) => {
              overlayRef.current = element
              if (element) {
                element.style.transform = `translateX(-${inputRef.current?.scrollLeft ?? 0}px)`
              }
            }}
            className='whitespace-pre'
          >
            {formatDisplayText(value, { availableEnvVars: availableEnvVars ?? NO_ENV_VARS })}
          </div>
        </div>
      )}
      {visible && (
        <EnvVarDropdown
          visible
          searchTerm={trigger.searchTerm}
          inputValue={value}
          cursorPosition={cursorPosition}
          workspaceId={workspaceId}
          inputRef={inputRef}
          onClose={() => setShowSecrets(false)}
          onSelect={(next, cursor) => {
            onChange(next)
            setCursorPosition(cursor)
            setShowSecrets(false)
            requestAnimationFrame(() => {
              inputRef.current?.focus()
              inputRef.current?.setSelectionRange(cursor, cursor)
            })
          }}
        />
      )}
    </div>
  )
}
