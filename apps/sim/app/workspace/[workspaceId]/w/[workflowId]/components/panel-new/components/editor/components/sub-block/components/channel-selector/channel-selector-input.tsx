'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext } from '@/hooks/selectors/types'

interface ChannelSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onChannelSelect?: (channelId: string) => void
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, any>
}

export function ChannelSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onChannelSelect,
  isPreview = false,
  previewValue,
  previewContextValues,
}: ChannelSelectorInputProps) {
  const params = useParams()
  const workflowIdFromUrl = (params?.workflowId as string) || ''
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [authMethod] = useSubBlockValue(blockId, 'authMethod')
  const [botToken] = useSubBlockValue(blockId, 'botToken')
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')

  const effectiveAuthMethod = previewContextValues?.authMethod ?? authMethod
  const effectiveBotToken = previewContextValues?.botToken ?? botToken
  const effectiveCredential = previewContextValues?.credential ?? connectedCredential
  const [_channelInfo, setChannelInfo] = useState<string | null>(null)

  const provider = subBlock.provider || 'slack'
  const isSlack = provider === 'slack'
  // Central dependsOn gating
  const { finalDisabled, dependsOn } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  // Choose credential strictly based on auth method - use effective values
  const credential: string =
    (effectiveAuthMethod as string) === 'bot_token'
      ? (effectiveBotToken as string) || ''
      : (effectiveCredential as string) || ''

  // Determine if connected OAuth credential is foreign (not applicable for bot tokens)
  const { isForeignCredential } = useForeignCredential(
    'slack',
    (effectiveAuthMethod as string) === 'bot_token' ? '' : (effectiveCredential as string) || ''
  )

  // Get the current value from the store or prop value if in preview mode (same pattern as file-selector)
  useEffect(() => {
    const val = isPreview && previewValue !== undefined ? previewValue : storeValue
    if (typeof val === 'string') {
      setChannelInfo(val)
    }
  }, [isPreview, previewValue, storeValue])

  const requiresCredential = dependsOn.includes('credential')
  const missingCredential = !credential || credential.trim().length === 0
  const shouldForceDisable = requiresCredential && (missingCredential || isForeignCredential)

  const context: SelectorContext = useMemo(
    () => ({
      credentialId: credential,
      workflowId: workflowIdFromUrl,
    }),
    [credential, workflowIdFromUrl]
  )

  if (!isSlack) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border border-dashed p-4 text-center text-muted-foreground text-sm'>
            Channel selector not supported for provider: {provider}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>This channel selector is not yet implemented for {provider}</p>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className='w-full'>
          <SelectorCombobox
            blockId={blockId}
            subBlock={subBlock}
            selectorKey='slack.channels'
            selectorContext={context}
            disabled={finalDisabled || shouldForceDisable || isForeignCredential}
            isPreview={isPreview}
            previewValue={previewValue ?? null}
            placeholder={subBlock.placeholder || 'Select Slack channel'}
            onOptionChange={(value) => {
              setChannelInfo(value)
              if (!isPreview) {
                onChannelSelect?.(value)
              }
            }}
          />
        </div>
      </Tooltip.Trigger>
    </Tooltip.Root>
  )
}
