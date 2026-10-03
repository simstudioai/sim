'use client'

import { ChipSelect, type ChipSelectProps, cn } from '@sim/emcn'

interface WorkspaceSelectProps
  extends Pick<
    ChipSelectProps,
    'id' | 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-required' | 'aria-invalid'
  > {
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
  ...fieldAria
}: WorkspaceSelectProps) {
  return (
    <ChipSelect
      placeholder={
        isLoading
          ? 'Loading workspaces…'
          : allowAllWorkspaces
            ? 'All workspaces'
            : 'Select workspaces…'
      }
      modal={false}
      {...fieldAria}
      multiSelect
      searchable
      align={fullWidth ? 'start' : 'end'}
      dropdownWidth={fullWidth ? 'trigger' : 'content'}
      options={options}
      multiSelectValues={workspaceIds}
      onMultiSelectChange={onChange}
      disabled={disabled || isLoading}
      showAllOption={allowAllWorkspaces}
      allOptionLabel={
        isLoading
          ? 'Loading workspaces…'
          : allowAllWorkspaces
            ? 'All workspaces'
            : 'Select workspaces…'
      }
      searchPlaceholder='Search workspaces…'
      fullWidth={fullWidth}
      className={cn(fullWidth ? undefined : 'w-auto max-w-none', className)}
    />
  )
}
