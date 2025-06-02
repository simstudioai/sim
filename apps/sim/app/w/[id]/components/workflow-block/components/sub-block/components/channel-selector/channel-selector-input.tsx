'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { type SlackChannelInfo, SlackChannelSelector } from './components/slack-channel-selector'

interface ChannelSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onChannelSelect?: (channelId: string) => void
  credential?: string // Optional credential override
}

export function ChannelSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onChannelSelect,
  credential: providedCredential,
}: ChannelSelectorInputProps) {
  const { getValue, setValue } = useSubBlockStore()
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

  // Get the current value from the store
  useEffect(() => {
    const value = getValue(blockId, subBlock.id)
    if (value && typeof value === 'string') {
      setSelectedChannelId(value)
    }
  }, [blockId, subBlock.id, getValue])

  // Handle channel selection
  const handleChannelChange = (channelId: string, info?: SlackChannelInfo) => {
    setSelectedChannelId(channelId)
    setChannelInfo(info || null)
    setValue(blockId, subBlock.id, channelId)
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
