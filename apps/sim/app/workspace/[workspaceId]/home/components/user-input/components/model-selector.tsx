'use client'

import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { Zap } from '@sim/emcn/icons'
import { MOTHERSHIP_EFFORT_OPTIONS, MOTHERSHIP_MODEL_OPTIONS } from '@/lib/mothership/model-options'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

/** Shared model, reasoning effort, and fast-mode controls for chat composers. */
export function ModelSelector() {
  const modelSelection = useMothershipEffortStore((state) => state.modelSelection)
  const setModel = useMothershipEffortStore((state) => state.setModel)
  const setFastMode = useMothershipEffortStore((state) => state.setFastMode)
  const effort = useMothershipEffortStore((state) => state.effort)
  const setEffort = useMothershipEffortStore((state) => state.setEffort)
  return (
    <div className='flex items-center'>
      {modelSelection.model === 'gpt-6-astra' && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Chip
              shape='round'
              aria-label='Fast mode'
              aria-pressed={modelSelection.fastMode}
              onClick={() => setFastMode(!modelSelection.fastMode)}
              leftAdornment={
                <Zap
                  className='size-[14px] text-[var(--text-icon)]'
                  fill={modelSelection.fastMode ? 'currentColor' : 'none'}
                />
              }
            />
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            {modelSelection.fastMode ? 'Turn off Fast mode' : 'Turn on Fast mode'}
          </Tooltip.Content>
        </Tooltip.Root>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip
            aria-label='Model and reasoning effort'
            className={modelSelection.model === 'gpt-6-astra' ? '-ml-2' : undefined}
          >
            {
              MOTHERSHIP_MODEL_OPTIONS.find((option) => option.value === modelSelection.model)
                ?.label
            }{' '}
            <span className='text-[var(--text-muted)]'>
              {MOTHERSHIP_EFFORT_OPTIONS.find((option) => option.value === effort)?.label}
            </span>
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='top' align='start'>
          {MOTHERSHIP_MODEL_OPTIONS.map((model) => (
            <DropdownMenuSub key={model.value}>
              <DropdownMenuSubTrigger>
                <DropdownMenuItemLabel label={model.label} />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup aria-label='Reasoning effort'>
                  {MOTHERSHIP_EFFORT_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      role='menuitemradio'
                      aria-checked={modelSelection.model === model.value && effort === option.value}
                      onSelect={() => {
                        setModel(model.value)
                        setEffort(option.value)
                      }}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
