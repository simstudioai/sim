'use client'

import type { RefObject } from 'react'
import { Icon } from '@sim/emcn/icon'
import {
  FieldPopover,
  FieldPopoverHeading,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/app/(product)/_components/field-popover/field-popover'
import { useEnvVarSuggestions } from '@/platform/lib/data/credentials'

interface EnvVarDropdownProps {
  visible: boolean
  /** Receives the field's whole new text with the chosen `{{SECRET}}` in place. */
  onSelect: (newValue: string, newCursorPosition: number) => void
  searchTerm?: string
  inputValue: string
  cursorPosition: number
  onClose: () => void
  workspaceId?: string
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>
}

/**
 * Secret names offered after `{{` (or in a key field), grouped by workspace and personal scope.
 * The field keeps focus: the suggestions hook reads arrow keys, Enter, Tab and Escape globally.
 */
export function EnvVarDropdown({
  visible,
  onSelect,
  searchTerm = '',
  inputValue,
  cursorPosition,
  onClose,
  workspaceId,
  inputRef,
}: EnvVarDropdownProps) {
  const {
    filteredEnvVars,
    filteredGroups,
    handleEnvVarSelect,
    openEnvironmentSettings,
    selectedIndex,
    setSelectedIndex,
  } = useEnvVarSuggestions({
    visible,
    onSelect,
    searchTerm,
    inputValue,
    cursorPosition,
    onClose,
    workspaceId,
  })
  useActiveRowIntoView(visible, selectedIndex)

  return (
    <FieldPopover
      label='Secrets'
      open={visible}
      anchor={inputRef}
      caretIndex={cursorPosition}
      onDismiss={onClose}
    >
      {filteredEnvVars.length === 0 ? (
        <FieldPopoverRow leading={<Icon name='I074' />} onSelect={openEnvironmentSettings}>
          Create Secret
        </FieldPopoverRow>
      ) : (
        filteredGroups.map((group) => (
          <div key={group.label} role='group' aria-label={group.label}>
            {workspaceId && <FieldPopoverHeading>{group.label}</FieldPopoverHeading>}
            {group.variables.map((envVar) => {
              const index = filteredEnvVars.indexOf(envVar)
              return (
                <FieldPopoverRow
                  key={`${group.label}-${envVar}`}
                  index={index}
                  active={index === selectedIndex}
                  onHover={() => setSelectedIndex(index)}
                  onSelect={() => handleEnvVarSelect(envVar)}
                >
                  {envVar}
                </FieldPopoverRow>
              )
            })}
          </div>
        ))
      )}
    </FieldPopover>
  )
}
