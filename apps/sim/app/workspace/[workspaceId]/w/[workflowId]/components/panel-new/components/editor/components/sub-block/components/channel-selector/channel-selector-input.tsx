'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import {
  type SlackChannelInfo,
  SlackChannelSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/channel-selector/components/slack-channel-selector'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'

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
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [_channelInfo, setChannelInfo] = useState<SlackChannelInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'slack'
  const isSlack = provider === 'slack'
  // Central dependsOn gating
  const { finalDisabled, dependsOn, dependencyValues } = useDependsOnGate(blockId, subBlock, {
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
    if (val && typeof val === 'string') {
      setSelectedChannelId(val)
    }
  }, [isPreview, previewValue, storeValue])

  // Clear channel when any declared dependency changes (e.g., authMethod/credential)
  const prevDepsSigRef = useRef<string>('')
  useEffect(() => {
    if (dependsOn.length === 0) return
    const currentSig = JSON.stringify(dependencyValues)
    if (prevDepsSigRef.current && prevDepsSigRef.current !== currentSig) {
      if (!isPreview) {
        setSelectedChannelId('')
        setChannelInfo(null)
        setStoreValue('')
      }
    }
    prevDepsSigRef.current = currentSig
  }, [dependsOn, dependencyValues, isPreview, setStoreValue])

  // Handle channel selection (same pattern as file-selector)
  const handleChannelChange = (channelId: string, info?: SlackChannelInfo) => {
    setSelectedChannelId(channelId)
    setChannelInfo(info || null)
    if (!isPreview) {
      setStoreValue(channelId)
    }
    onChannelSelect?.(channelId)
  }

  // Render Slack channel selector
  if (isSlack) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full'>
            <SlackChannelSelector
              value={selectedChannelId}
              onChange={(channelId: string, channelInfo?: SlackChannelInfo) => {
                handleChannelChange(channelId, channelInfo)
              }}
              credential={credential}
              label={subBlock.placeholder || 'Select Slack channel'}
              disabled={finalDisabled}
              workflowId={workflowIdFromUrl}
              isForeignCredential={isForeignCredential}
            />
          </div>
        </Tooltip.Trigger>
      </Tooltip.Root>
    )
  }

  // Default fallback for unsupported providers
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
