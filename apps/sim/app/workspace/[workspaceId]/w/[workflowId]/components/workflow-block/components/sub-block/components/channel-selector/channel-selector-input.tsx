'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  type SlackChannelInfo,
  SlackChannelSelector,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/channel-selector/components/slack-channel-selector'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'

interface ChannelSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onChannelSelect?: (channelId: string) => void
  isPreview?: boolean
  previewValue?: any | null
}

export function ChannelSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onChannelSelect,
  isPreview = false,
  previewValue,
}: ChannelSelectorInputProps) {
  const params = useParams()
  const workflowIdFromUrl = (params?.workflowId as string) || ''
  // Use the proper hook to get the current value and setter (same as file-selector)
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  // Reactive upstream fields
  const [authMethod] = useSubBlockValue(blockId, 'authMethod')
  const [botToken] = useSubBlockValue(blockId, 'botToken')
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [_channelInfo, setChannelInfo] = useState<SlackChannelInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'slack'
  const isSlack = provider === 'slack'
  // Central dependsOn gating
  const { finalDisabled, dependsOn, dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
  })

  // Choose credential strictly based on auth method
  const credential: string =
    (authMethod as string) === 'bot_token'
      ? (botToken as string) || ''
      : (connectedCredential as string) || ''

  // Determine if connected OAuth credential is foreign (not applicable for bot tokens)
  const { isForeignCredential } = useForeignCredential(
    'slack',
    (authMethod as string) === 'bot_token' ? '' : (connectedCredential as string) || ''
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Default fallback for unsupported providers
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='w-full rounded border border-dashed p-4 text-center text-muted-foreground text-sm'>
            Channel selector not supported for provider: {provider}
          </div>
        </TooltipTrigger>
        <TooltipContent side='top'>
          <p>This channel selector is not yet implemented for {provider}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
