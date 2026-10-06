'use client'

import { useEffect } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuRadioGroup,
} from '@sim/emcn'
import { Brain, Check, Sparkles } from '@sim/emcn/icons'
import {
  MOTHERSHIP_MODEL_OPTIONS,
  MOTHERSHIP_SIMPLE_EFFORT_OPTIONS,
  type MothershipEffort,
  mothershipEffortOptions,
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
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'

/** Model, reasoning effort, and Fast mode for Build chat composers. */
export function ModelSelector() {
  const advanced = useFeatureFlag('mothership-model-selector')
  const selection = useMothershipEffortStore((state) => state.modelSelection)
  const setModel = useMothershipEffortStore((state) => state.setModel)
  const setFastMode = useMothershipEffortStore((state) => state.setFastMode)
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
    advanced
  )
  const options = advanced
    ? mothershipEffortOptions(modelSelection.model)
    : MOTHERSHIP_SIMPLE_EFFORT_OPTIONS
  const setEffort = (choice: MothershipEffort) => {
    if (chatId) saveChatEffort(choice)
    else setNewChatEffort(choice)
  }

  useEffect(() => {
    if (chatId) return
    return () => useMothershipEffortStore.getState().setNewChatEffort(null)
  }, [chatId])

  const effortLabel = options.find((option) => option.value === effort)?.label ?? effort
  const modelLabel =
    MOTHERSHIP_MODEL_OPTIONS.find((option) => option.value === modelSelection.model)?.label ??
    modelSelection.model

  return (
    <div className='flex items-center gap-[inherit]'>
      {advanced && (
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
              valueLabel={modelLabel}
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
