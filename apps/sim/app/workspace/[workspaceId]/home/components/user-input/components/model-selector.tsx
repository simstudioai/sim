'use client'

import {
  Chip,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown, Zap } from '@sim/emcn/icons'
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip
          aria-label='Model and reasoning effort'
          leftIcon={modelSelection.fastMode ? Zap : undefined}
          rightIcon={ChevronDown}
        >
          {MOTHERSHIP_MODEL_OPTIONS.find((option) => option.value === modelSelection.model)?.label}{' '}
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
              {modelSelection.model === model.value && <Check className='size-[14px]' />}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={modelSelection.model === model.value ? effort : ''}
                onValueChange={(value) => {
                  const option = MOTHERSHIP_EFFORT_OPTIONS.find((option) => option.value === value)
                  if (!option) return
                  setModel(model.value)
                  setEffort(option.value)
                }}
              >
                {MOTHERSHIP_EFFORT_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {modelSelection.model === 'gpt-6-astra' && (
          <DropdownMenuCheckboxItem
            checked={modelSelection.fastMode}
            onCheckedChange={(checked) => setFastMode(checked === true)}
          >
            <Zap className='size-[14px]' />
            Fast mode
          </DropdownMenuCheckboxItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
