'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { type SlackChannelInfo, SlackChannelSelector } from './components/slack-channel-selector'

interface ChannelSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onChannelSelect?: (channelId: string) => void
  credential?: string
  isPreview?: boolean
  previewValue?: any | null
}

export function ChannelSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onChannelSelect,
  credential: providedCredential,
  isPreview = false,
  previewValue,
}: ChannelSelectorInputProps) {
  const { getValue } = useSubBlockStore()

  // Use the proper hook to get the current value and setter (same as file-selector)
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [_channelInfo, setChannelInfo] = useState<SlackChannelInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'slack'
  const isSlack = provider === 'slack'

  // Get the credential for the provider - use provided credential or fall back to store
  const authMethod = getValue(blockId, 'authMethod') as string
  const botToken = getValue(blockId, 'botToken') as string

  let credential: string
  if (providedCredential) {
    credential = providedCredential
  } else if (authMethod === 'bot_token' && botToken) {
    credential = botToken
  } else {
    credential = (getValue(blockId, 'credential') as string) || ''
  }

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Get the current value from the store or prop value if in preview mode (same pattern as file-selector)
  useEffect(() => {
    if (isPreview && previewValue !== undefined) {
      const value = previewValue
      if (value && typeof value === 'string') {
        setSelectedChannelId(value)
      }
    } else {
      const value = getValue(blockId, subBlock.id)
      if (value && typeof value === 'string') {
        setSelectedChannelId(value)
      }
    }
  }, [blockId, subBlock.id, getValue, isPreview, previewValue])

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
                disabled={disabled || !credential}
              />
            </div>
          </TooltipTrigger>
          {!credential && (
            <TooltipContent side='top'>
              <p>Please select a Slack account or enter a bot token first</p>
            </TooltipContent>
          )}
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
