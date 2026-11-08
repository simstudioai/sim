'use client'

import { SecretInput } from '@sim/emcn-legacy'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { useConnectorApiKeyField } from '@/hooks/kb/connectors/use-connector-api-key-field'

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
  const field = useConnectorApiKeyField({ value, onChange, workspaceId })
  const visible = field.suggestionsVisible

  return (
    <div className='relative' data-chip-modal-enter-owner={visible ? '' : undefined}>
      <SecretInput
        ref={field.inputRef}
        value={value}
        onChange={field.handleChange}
        onSelect={(event) => field.handleSelect(event.currentTarget.selectionStart)}
        onFocus={field.handleFocus}
        onBlur={field.handleBlur}
        onScroll={(event) => field.handleScroll(event.currentTarget.scrollLeft)}
        inputClassName={
          field.isFocused ? 'text-transparent caret-[var(--text-primary)]' : undefined
        }
        placeholder={placeholder}
      />
      {field.isFocused && (
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2 text-[var(--text-body)] text-sm'
        >
          <div ref={field.attachOverlay} className='whitespace-pre'>
            {formatDisplayText(value, { availableEnvVars: field.availableEnvVars })}
          </div>
        </div>
      )}
      {visible && (
        <EnvVarDropdown
          visible
          searchTerm={field.searchTerm}
          inputValue={value}
          cursorPosition={field.cursorPosition}
          workspaceId={workspaceId}
          inputRef={field.inputRef}
          onClose={field.closeSuggestions}
          onSelect={field.handleSuggestion}
        />
      )}
    </div>
  )
}
