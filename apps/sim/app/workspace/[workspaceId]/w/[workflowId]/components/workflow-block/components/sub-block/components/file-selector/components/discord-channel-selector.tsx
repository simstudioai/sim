'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react'
import { DiscordIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DiscordChannelSelector')

export interface DiscordChannelInfo {
  id: string
  name: string
  type: number
}

interface DiscordChannelSelectorProps {
  value: string
  onChange: (value: string, channelInfo?: DiscordChannelInfo) => void
  botToken: string
  serverId: string
  label?: string
  disabled?: boolean
  showPreview?: boolean
  onChannelInfoChange?: (info: DiscordChannelInfo | null) => void
}

export function DiscordChannelSelector({
  value,
  onChange,
  botToken,
  serverId,
  label = 'Select Discord channel',
  disabled = false,
  showPreview = true,
  onChannelInfoChange,
}: DiscordChannelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [channels, setChannels] = useState<DiscordChannelInfo[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState(value)
  const [selectedChannel, setSelectedChannel] = useState<DiscordChannelInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  // Fetch channels from Discord API
  const fetchChannels = useCallback(async () => {
    if (!botToken || !serverId) {
      setError(!botToken ? 'Bot token is required' : 'Server ID is required')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/tools/discord/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ botToken, serverId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch Discord channels')
      }

      const data = await response.json()
      setChannels(data.channels || [])

      // If we have a selected channel ID, find the channel info
      const currentSelectedId = selectedChannelId // Store in local variable
      if (currentSelectedId) {
        const channelInfo = data.channels?.find(
          (channel: DiscordChannelInfo) => channel.id === currentSelectedId
        )
        if (channelInfo) {
          setSelectedChannel(channelInfo)
          onChannelInfoChange?.(channelInfo)
        }
      }
    } catch (error) {
      logger.error('Error fetching channels:', error)
      setError((error as Error).message)
      setChannels([])
    } finally {
      setIsLoading(false)
      setInitialFetchDone(true)
    }
  }, [botToken, serverId, selectedChannelId, onChannelInfoChange])

  // Handle open change - only fetch channels when the dropdown is opened
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    // Only fetch channels when opening the dropdown and if we have valid token and server
    if (isOpen && botToken && serverId && (!initialFetchDone || channels.length === 0)) {
      fetchChannels()
    }
  }

  // Fetch only the selected channel info when component mounts or when selectedChannelId changes
  // This is more efficient than fetching all channels
  const fetchSelectedChannelInfo = useCallback(async () => {
    if (!botToken || !serverId || !selectedChannelId) return

    setIsLoading(true)
    setError(null)

    try {
      // Only fetch the specific channel by ID instead of all channels
      const response = await fetch('/api/tools/discord/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          botToken,
          serverId,
          channelId: selectedChannelId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch Discord channel')
      }

      const data = await response.json()
      if (data.channel) {
        setSelectedChannel(data.channel)
        onChannelInfoChange?.(data.channel)
      } else if (data.channels && data.channels.length > 0) {
        const channelInfo = data.channels.find(
          (channel: DiscordChannelInfo) => channel.id === selectedChannelId
        )
        if (channelInfo) {
          setSelectedChannel(channelInfo)
          onChannelInfoChange?.(channelInfo)
        }
      }
    } catch (error) {
      logger.error('Error fetching channel info:', error)
      setError((error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [botToken, serverId, selectedChannelId, onChannelInfoChange])

  // Fetch selected channel info when component mounts or dependencies change
  useEffect(() => {
    if (value && botToken && serverId && (!selectedChannel || selectedChannel.id !== value)) {
      fetchSelectedChannelInfo()
    }
  }, [value, botToken, serverId, selectedChannel, fetchSelectedChannelInfo])

  // Sync with external value
  useEffect(() => {
    if (value !== selectedChannelId) {
      setSelectedChannelId(value)

      // Find channel info for the new value
      if (value && channels.length > 0) {
        const channelInfo = channels.find((channel) => channel.id === value)
        setSelectedChannel(channelInfo || null)
        onChannelInfoChange?.(channelInfo || null)
      } else if (value) {
        // If we have a value but no channel info, we might need to fetch it
        if (!selectedChannel || selectedChannel.id !== value) {
          fetchSelectedChannelInfo()
        }
      } else {
        setSelectedChannel(null)
        onChannelInfoChange?.(null)
      }
    }
  }, [
    value,
    channels,
    selectedChannelId,
    selectedChannel,
    fetchSelectedChannelInfo,
    onChannelInfoChange,
  ])

  // Handle channel selection
  const handleSelectChannel = (channel: DiscordChannelInfo) => {
    setSelectedChannelId(channel.id)
    setSelectedChannel(channel)
    onChange(channel.id, channel)
    onChannelInfoChange?.(channel)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedChannelId('')
    setSelectedChannel(null)
    onChange('', undefined)
    onChannelInfoChange?.(null)
    setError(null)
  }

  return (
    <div className='space-y-2'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='h-10 w-full min-w-0 justify-between'
            disabled={disabled || !botToken || !serverId}
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              {selectedChannel ? (
                <>
                  <span className='text-muted-foreground'>#</span>
                  <span className='truncate font-normal'>{selectedChannel.name}</span>
                </>
              ) : (
                <>
                  <DiscordIcon className='h-4 w-4' />
                  <span className='truncate text-muted-foreground'>{label}</span>
                </>
              )}
            </div>
            <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search channels...' />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading channels...</span>
                  </div>
                ) : error ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{error}</p>
                  </div>
                ) : channels.length === 0 ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No channels found</p>
                    <p className='text-muted-foreground text-xs'>
                      The bot needs access to view channels in this server
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No matching channels</p>
                  </div>
                )}
              </CommandEmpty>

              {channels.length > 0 && (
                <CommandGroup>
                  <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                    Channels
                  </div>
                  {channels.map((channel) => (
                    <CommandItem
                      key={channel.id}
                      value={`channel-${channel.id}-${channel.name}`}
                      onSelect={() => handleSelectChannel(channel)}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-2 overflow-hidden'>
                        <span className='text-muted-foreground'>#</span>
                        <span className='truncate font-normal'>{channel.name}</span>
                      </div>
                      {channel.id === selectedChannelId && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Channel preview */}
      {showPreview && selectedChannel && (
        <div className='relative mt-2 rounded-md border border-muted bg-muted/10 p-2'>
          <div className='absolute top-2 right-2'>
            <Button
              variant='ghost'
              size='icon'
              className='h-5 w-5 hover:bg-muted'
              onClick={handleClearSelection}
            >
              <X className='h-3 w-3' />
            </Button>
          </div>
          <div className='flex items-center gap-3 pr-4'>
            <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted/20'>
              <span className='font-semibold text-muted-foreground'>#</span>
            </div>
            <div className='min-w-0 flex-1 overflow-hidden'>
              <h4 className='truncate font-medium text-xs'>{selectedChannel.name}</h4>
              <div className='text-muted-foreground text-xs'>Channel ID: {selectedChannel.id}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
