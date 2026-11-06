'use client'

import { useId } from 'react'
import { formatDisplayText } from '@sim/workflow-renderer/formatted-text'
import { useConnectorApiKeyField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/use-connector-api-key-field'
import { useEnvVarSuggestions } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown/use-env-var-suggestions'
import { FieldFrame, Input, PopupNote, PopupRow } from '@/platform/design-system/components'
import apiKey from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/api-key-field.module.css'

interface ApiKeyFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  workspaceId?: string
  disabled?: boolean
}

interface ApiKeySuggestionsProps {
  searchTerm: string
  inputValue: string
  cursorPosition: number
  workspaceId?: string
  onClose: () => void
  onSelect: (newValue: string, newCursorPosition: number) => void
}

/** Mounted only while a `{{` is open, so secret names are read only when asked for. */
function ApiKeySuggestions({
  searchTerm,
  inputValue,
  cursorPosition,
  workspaceId,
  onClose,
  onSelect,
}: ApiKeySuggestionsProps) {
  const suggestions = useEnvVarSuggestions({
    visible: true,
    onSelect,
    searchTerm,
    inputValue,
    cursorPosition,
    onClose,
    workspaceId,
  })
  return (
    <div className={apiKey.suggestions} data-material='floating' data-elevation='menu'>
      {suggestions.filteredEnvVars.length === 0 ? (
        <PopupRow
          icon='I074'
          onMouseDown={(event) => {
            event.preventDefault()
            suggestions.openEnvironmentSettings()
          }}
        >
          Create Secret
        </PopupRow>
      ) : (
        suggestions.filteredGroups.map((group) => (
          <div key={group.label}>
            {workspaceId && <PopupNote>{group.label}</PopupNote>}
            {group.variables.map((envVar) => {
              const index = suggestions.filteredEnvVars.indexOf(envVar)
              return (
                <div key={`${group.label}-${envVar}`} data-env-var-index={index}>
                  <PopupRow
                    highlighted={index === suggestions.selectedIndex}
                    onMouseEnter={() => suggestions.setSelectedIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      suggestions.handleEnvVarSelect(envVar)
                    }}
                  >
                    {envVar}
                  </PopupRow>
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}

const MASK = '•'

/**
 * Takes a key or a `{{SECRET}}` reference. Bullets replace the value in the input until it is
 * focused, so an unfocused key is never in the DOM; while focused the text
 * is drawn by an overlay that colors its references.
 */
export function ApiKeyField({
  label,
  value,
  onChange,
  placeholder,
  workspaceId,
  disabled,
}: ApiKeyFieldProps) {
  const id = useId()
  const field = useConnectorApiKeyField({ value, onChange, workspaceId })
  return (
    <FieldFrame id={id} label={label} hint='Paste a key, or type {{ to reference a secret.'>
      <div className={apiKey.frame} data-typing={field.isFocused || undefined}>
        <Input
          id={id}
          label={label}
          type='text'
          inputRef={field.inputRef}
          value={field.isFocused ? value : MASK.repeat(value.length)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete='off'
          spellCheck={false}
          onChange={(next) => {
            if (field.isFocused) field.handleChange(next)
          }}
          onSelect={(event) => field.handleSelect(event.currentTarget.selectionStart)}
          onFocus={field.handleFocus}
          onBlur={field.handleBlur}
          onScroll={(event) => field.handleScroll(event.currentTarget.scrollLeft)}
        />
        {field.isFocused && (
          <div aria-hidden='true' className={apiKey.overlay} data-type='T043'>
            <div ref={field.attachOverlay}>
              {formatDisplayText(value, { availableEnvVars: field.availableEnvVars })}
            </div>
          </div>
        )}
        {field.suggestionsVisible && (
          <ApiKeySuggestions
            searchTerm={field.searchTerm}
            inputValue={value}
            cursorPosition={field.cursorPosition}
            workspaceId={workspaceId}
            onClose={field.closeSuggestions}
            onSelect={field.handleSuggestion}
          />
        )}
      </div>
    </FieldFrame>
  )
}
