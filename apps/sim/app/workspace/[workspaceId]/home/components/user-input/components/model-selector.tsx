'use client'

import {
  Chip,
  ChipDropdown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '@sim/emcn'
import {
  MOTHERSHIP_MODEL_OPTIONS,
  MOTHERSHIP_SIMPLE_EFFORT_OPTIONS,
  mothershipEffortOptions,
  resolveMothershipModelSettings,
} from '@/lib/mothership/model-options'
import { FastModeToggle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/fast-mode-toggle'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

/** Reasoning effort and Fast mode for Build chat composers. */
export function ModelSelector() {
  const advanced = useFeatureFlag('mothership-model-selector')
  const selection = useMothershipEffortStore((state) => state.modelSelection)
  const setModel = useMothershipEffortStore((state) => state.setModel)
  const setFastMode = useMothershipEffortStore((state) => state.setFastMode)
  const storedEffort = useMothershipEffortStore((state) => state.effort)
  const { effort, modelSelection } = resolveMothershipModelSettings(
    { effort: storedEffort, modelSelection: selection },
    advanced
  )
  const options = advanced
    ? mothershipEffortOptions(modelSelection.model)
    : MOTHERSHIP_SIMPLE_EFFORT_OPTIONS
  const setEffort = useMothershipEffortStore((state) => state.setEffort)
  return (
    <div className='flex items-center'>
      {advanced && (
        <>
          {modelSelection.model !== 'claude-opus-5-5' && (
            <FastModeToggle
              enabled={modelSelection.fastMode}
              onChange={setFastMode}
              description='Faster responses at a higher price'
            />
          )}
          <ChipDropdown
            variant='default'
            className='border-0'
            aria-label='Model'
            value={modelSelection.model}
            options={MOTHERSHIP_MODEL_OPTIONS}
            matchTriggerWidth={false}
            onChange={(value) => {
              const model = MOTHERSHIP_MODEL_OPTIONS.find((option) => option.value === value)
              if (model) setModel(model.value)
            }}
          />
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip aria-label='Reasoning effort' className={advanced ? undefined : '-ml-2'}>
            {options.find((option) => option.value === effort)?.label}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='top' align='start'>
          <DropdownMenuRadioGroup aria-label='Reasoning effort'>
            {options.map((option) => (
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
