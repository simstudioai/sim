'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuRadioGroup,
} from '@sim/emcn'
import { Brain, Check, Sparkles } from '@sim/emcn/icons'
import {
  MOTHERSHIP_EFFORT_OPTIONS,
  MOTHERSHIP_MODEL_OPTIONS,
  MOTHERSHIP_SIMPLE_EFFORT_OPTIONS,
  type MothershipEffort,
  resolveMothershipModelSettings,
} from '@/lib/mothership/model-options'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { FastModeToggle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/fast-mode-toggle'
import { ModelSettingTrigger } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-setting-trigger'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import {
  useMothershipChatHistory,
  useSetMothershipChatEffort,
} from '@/hooks/queries/mothership-chats'
import { useMothershipEffortStore, useMothershipPlanEffortStore } from '@/stores/mothership-effort/store'

/** Model, reasoning effort, and Fast mode for Build chat composers. */
export function ModelSelector({ plan = false }: { plan?: boolean }) {
  const usePreferenceStore = plan ? useMothershipPlanEffortStore : useMothershipEffortStore
  const advanced = useFeatureFlag('mothership-model-selector')
  const selection = usePreferenceStore((state) => state.modelSelection)
  const setModel = usePreferenceStore((state) => state.setModel)
  const setFastMode = usePreferenceStore((state) => state.setFastMode)
  const { chatId } = useChatSurface()
  const { data: chatHistory } = useMothershipChatHistory(chatId)
  const chatPick = useMothershipEffortStore((state) =>
    chatId ? state.chatEfforts[chatId]?.effort : undefined
  )
  const newChatEffort = useMothershipEffortStore((state) => state.newChatEffort)
  const setNewChatEffort = useMothershipEffortStore((state) => state.setNewChatEffort)
  const { mutate: saveChatEffort } = useSetMothershipChatEffort(chatId)
  const effortChoice = chatId ? (chatPick ?? chatHistory?.effort) : newChatEffort
  const { effort, modelSelection } = resolveMothershipModelSettings(
    { effort: effortChoice ?? undefined, modelSelection: selection },
    advanced,
    plan
  )
  const options = modelSelection ? MOTHERSHIP_EFFORT_OPTIONS : MOTHERSHIP_SIMPLE_EFFORT_OPTIONS
  const setEffort = (choice: MothershipEffort) => {
    if (chatId) saveChatEffort(choice)
    else setNewChatEffort(choice)
  }

  const effortLabel = options.find((option) => option.value === effort)?.label ?? effort

  return (
    <div className='flex items-center gap-[inherit]'>
      {modelSelection && (
        <>
          {modelSelection.model !== 'claude-opus-5-5' && (
            <FastModeToggle
              enabled={modelSelection.fastMode}
              onChange={setFastMode}
              description='Faster responses at a higher price'
            />
          )}
          <DropdownMenu modal={false}>
            <ModelSettingTrigger
              label='Model'
              valueLabel={
                MOTHERSHIP_MODEL_OPTIONS.find((option) => option.value === modelSelection.model)
                  ?.label ?? modelSelection.model
              }
              icon={Sparkles}
              showChevron
            />
            <DropdownMenuContent side='top' align='end'>
              {MOTHERSHIP_MODEL_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.value} onSelect={() => setModel(option.value)}>
                  <DropdownMenuItemLabel label={option.label} />
                  {modelSelection.model === option.value && (
                    <Check className='ml-auto! size-[16px]!' />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <DropdownMenu>
        <ModelSettingTrigger label='Reasoning effort' valueLabel={effortLabel} icon={Brain} />
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
