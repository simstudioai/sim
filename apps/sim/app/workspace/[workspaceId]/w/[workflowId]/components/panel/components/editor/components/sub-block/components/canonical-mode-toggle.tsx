import { IconSwitch } from '@sim/emcn'
import { List } from '@sim/emcn/icons'
import { VariableIcon } from '@/components/icons'
import type { CanonicalMode } from '@/lib/workflows/subblocks/visibility'

interface CanonicalModeToggleProps {
  mode: CanonicalMode
  disabled?: boolean
  onToggle?: () => void
}

const MODE_OPTIONS = [
  { value: 'basic', label: 'Selector', icon: List },
  { value: 'advanced', label: 'Variable', icon: VariableIcon },
] as const

export function CanonicalModeToggle({ mode, disabled, onToggle }: CanonicalModeToggleProps) {
  return (
    <IconSwitch
      options={MODE_OPTIONS}
      value={mode}
      onValueChange={() => onToggle?.()}
      disabled={disabled}
      showTooltips
      aria-label='Input mode'
    />
  )
}
