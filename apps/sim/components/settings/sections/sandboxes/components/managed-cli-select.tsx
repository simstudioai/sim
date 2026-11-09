'use client'

import { ChipSelect } from '@sim/emcn-legacy'
import { CLI_TOOL_GROUPS } from '@/components/settings/sections/sandboxes/utils'
import type { SandboxCliToolId } from '@/lib/api/contracts/sandboxes'
import { SANDBOX_CLI_TOOLS } from '@/lib/execution/remote-sandbox/cli-tools'

interface ManagedCliSelectProps {
  value: SandboxCliToolId[]
  onChange: (value: SandboxCliToolId[]) => void
  disabled?: boolean
  stayBelow?: boolean
}

export function ManagedCliSelect({
  value,
  onChange,
  disabled = false,
  stayBelow = false,
}: ManagedCliSelectProps) {
  const displayLabel =
    value.length === 1
      ? SANDBOX_CLI_TOOLS[value[0]].label
      : value.length > 1
        ? `${value.length} selected`
        : undefined

  const handleChange = (proposed: string[]) => {
    onChange(proposed as SandboxCliToolId[])
  }

  return (
    <ChipSelect
      align='start'
      fullWidth
      dropdownWidth='trigger'
      stayBelow={stayBelow}
      multiSelect
      searchable
      searchPlaceholder='Search managed CLI tools...'
      placeholder='Select managed CLI tools'
      displayLabel={displayLabel}
      groups={CLI_TOOL_GROUPS}
      multiSelectValues={value}
      onMultiSelectChange={handleChange}
      showAllOption={false}
      disabled={disabled}
      aria-label='Managed CLI tools'
    />
  )
}
