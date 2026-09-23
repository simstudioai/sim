'use client'

import { useRef, useState } from 'react'
import { SecretInput } from '@sim/emcn'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'

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
  const [cursorPosition, setCursorPosition] = useState(0)
  const [showSecrets, setShowSecrets] = useState(false)
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
        inputClassName={
          value.trimStart().startsWith('{{') ? 'text-[var(--brand-secondary)]' : undefined
        }
        placeholder={placeholder}
      />
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
