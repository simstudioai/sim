'use client'

import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { MOTHERSHIP_EFFORT_OPTIONS } from '@/lib/mothership/model-options'
import { FastModeToggle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/fast-mode-toggle'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

/** Reasoning effort and Fast mode for Build chat composers. */
export function ModelSelector() {
  const fastMode = useMothershipEffortStore((state) => state.modelSelection.fastMode)
  const setFastMode = useMothershipEffortStore((state) => state.setFastMode)
  const effort = useMothershipEffortStore((state) => state.effort)
  const setEffort = useMothershipEffortStore((state) => state.setEffort)
  return (
    <div className='flex items-center'>
      <FastModeToggle
        enabled={fastMode}
        onChange={setFastMode}
        description='Faster responses at a higher price'
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip aria-label='Reasoning effort' className='-ml-2'>
            {MOTHERSHIP_EFFORT_OPTIONS.find((option) => option.value === effort)?.label}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='top' align='start'>
          <DropdownMenuRadioGroup aria-label='Reasoning effort'>
            {MOTHERSHIP_EFFORT_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                role='menuitemradio'
                aria-checked={effort === option.value}
                onSelect={() => setEffort(option.value)}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
