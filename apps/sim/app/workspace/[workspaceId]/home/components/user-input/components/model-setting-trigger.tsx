import type { ComponentType } from 'react'
import { Chip, chipContentLabelClass, DropdownMenuTrigger, OverflowText, Tooltip } from '@sim/emcn'
import { ChevronDown } from '@sim/emcn/icons'

interface ModelSettingTriggerProps {
  label: string
  valueLabel: string
  icon: ComponentType<{ className?: string }>
  showChevron?: boolean
}

/** Keeps one accessible trigger while replacing its label with an icon in narrow composers. */
export function ModelSettingTrigger({
  label,
  valueLabel,
  icon: Icon,
  showChevron = false,
}: ModelSettingTriggerProps) {
  return (
    <Tooltip.Root preferAbove>
      <Tooltip.Trigger asChild>
        <DropdownMenuTrigger asChild>
          <Chip
            aria-label={label}
            aria-description={valueLabel}
            leftAdornment={
              <>
                <Icon className='@max-[280px]/input-toolbar:block hidden size-[14px] text-[var(--text-icon)]' />
                <span className='flex @max-[280px]/input-toolbar:hidden min-w-0 items-center gap-2'>
                  <OverflowText
                    label={valueLabel}
                    className={chipContentLabelClass}
                    focusTarget='nearest-interactive'
                  />
                  {showChevron && (
                    <ChevronDown className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  )}
                </span>
              </>
            }
          />
        </DropdownMenuTrigger>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {label}: {valueLabel}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
