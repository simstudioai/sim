'use client'

import { Checkbox } from '@sim/emcn/checkbox'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'
import type { SlackCapability } from '@/platform/lib/data/workflow-editor/uploads'

interface CapabilityCheckboxProps {
  blockId: string
  capability: SlackCapability
  checked: boolean
  disabled: boolean
}

/** One Slack capability; its id is also the sub-block that stores whether it is enabled. */
export function CapabilityCheckbox({
  blockId,
  capability,
  checked,
  disabled,
}: CapabilityCheckboxProps) {
  const [, setEnabled] = useSubBlockValue<boolean>(blockId, capability.id)
  return (
    <Checkbox
      label={capability.label}
      description={capability.description}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        if (!disabled) setEnabled(next)
      }}
    />
  )
}
