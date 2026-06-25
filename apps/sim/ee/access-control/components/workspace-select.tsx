'use client'

import { ChipDropdown } from '@/components/emcn'

interface WorkspaceSelectProps {
  workspaceIds: string[]
  onChange: (ids: string[]) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  isLoading?: boolean
  fullWidth?: boolean
  className?: string
  /**
   * When false, the "All workspaces" reset option is hidden and an empty
   * selection reads as a prompt. Non-default groups must target ≥1 workspace.
   */
  allowAllWorkspaces?: boolean
}

/**
 * Workspace scope multi-select. With `allowAllWorkspaces` an empty selection
 * reads as "All workspaces" (the default group); otherwise it prompts for a
 * selection, since non-default groups must target specific workspaces.
 */
export function WorkspaceSelect({
  workspaceIds,
  onChange,
  options,
  disabled = false,
  isLoading = false,
  fullWidth = false,
  className,
  allowAllWorkspaces = true,
}: WorkspaceSelectProps) {
  return (
    <ChipDropdown
      multiple
      searchable
      align={fullWidth ? 'start' : 'end'}
      matchTriggerWidth={fullWidth}
      options={options}
      value={workspaceIds}
      onChange={onChange}
      disabled={disabled || isLoading}
      showAllOption={allowAllWorkspaces}
      allLabel={
        isLoading
          ? 'Loading workspaces…'
          : allowAllWorkspaces
            ? 'All workspaces'
            : 'Select workspaces…'
      }
      searchPlaceholder='Search workspaces…'
      fullWidth={fullWidth}
      className={className}
    />
  )
}
