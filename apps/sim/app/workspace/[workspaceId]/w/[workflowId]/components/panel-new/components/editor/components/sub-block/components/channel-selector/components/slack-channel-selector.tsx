import { useCallback, useState } from 'react'
import { Check, ChevronDown, Hash, Lock, RefreshCw } from 'lucide-react'
import { SlackIcon } from '@/components/icons'
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
import { useDisplayNamesStore } from '@/stores/display-names/store'

export interface SlackChannelInfo {
  id: string
  name: string
  isPrivate: boolean
}

interface SlackChannelSelectorProps {
  value: string
  onChange: (channelId: string, channelInfo?: SlackChannelInfo) => void
  credential: string
  label?: string
  disabled?: boolean
  workflowId?: string
  isForeignCredential?: boolean
}

export function SlackChannelSelector({
  value,
  onChange,
  credential,
  label = 'Select Slack channel',
  disabled = false,
  workflowId,
  isForeignCredential = false,
}: SlackChannelSelectorProps) {
  const [channels, setChannels] = useState<SlackChannelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  // Get cached display name
  const cachedChannelName = useDisplayNamesStore(
    useCallback(
      (state) => {
        if (!credential || !value) return null
        return state.cache.channels[credential]?.[value] || null
      },
      [credential, value]
    )
  )

  // Fetch channels from Slack API
  const fetchChannels = useCallback(async () => {
    if (!credential) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/tools/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, workflowId }),
      })

      if (!res.ok) {
        const errorData = await res
          .json()
          .catch(() => ({ error: `HTTP error! status: ${res.status}` }))
        setError(errorData.error || `HTTP error! status: ${res.status}`)
        setChannels([])
        setInitialFetchDone(true)
        return
      }

      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setChannels([])
        setInitialFetchDone(true)
      } else {
        setChannels(data.channels)
        setInitialFetchDone(true)

        // Cache channel names in display names store
        if (credential) {
          const channelMap = data.channels.reduce(
            (acc: Record<string, string>, ch: SlackChannelInfo) => {
              acc[ch.id] = `#${ch.name}`
              return acc
            },
            {}
          )
          useDisplayNamesStore.getState().setDisplayNames('channels', credential, channelMap)
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
      setChannels([])
      setInitialFetchDone(true)
    } finally {
      setLoading(false)
    }
  }, [credential])

  // Handle dropdown open/close - fetch channels when opening
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    // Only fetch channels when opening the dropdown and if we have valid credential
    if (isOpen && credential && (!initialFetchDone || channels.length === 0)) {
      fetchChannels()
    }
  }

  const handleSelectChannel = (channel: SlackChannelInfo) => {
    onChange(channel.id, channel)
    setOpen(false)
  }

  const getChannelIcon = (channel: SlackChannelInfo) => {
    return channel.isPrivate ? <Lock className='h-1.5 w-1.5' /> : <Hash className='h-1.5 w-1.5' />
  }

  const formatChannelName = (channel: SlackChannelInfo) => {
    return channel.name
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='relative w-full justify-between'
          disabled={disabled || !credential}
          title={isForeignCredential ? 'Using a shared account' : undefined}
        >
          <div className='flex max-w-[calc(100%-20px)] items-center gap-2 overflow-hidden'>
            <SlackIcon className='h-4 w-4 text-[#611f69]' />
            {cachedChannelName ? (
              <span className='truncate font-normal'>{cachedChannelName}</span>
            ) : (
              <span className='truncate text-muted-foreground'>{label}</span>
            )}
          </div>
          <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[250px] p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search channels...' />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>Loading channels...</span>
                </div>
              ) : error ? (
                <div className='p-4 text-center'>
                  <p className='text-destructive text-sm'>{error}</p>
                </div>
              ) : !credential ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>Missing credentials</p>
                  <p className='text-muted-foreground text-xs'>
                    Please configure Slack credentials.
                  </p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>No channels found</p>
                  <p className='text-muted-foreground text-xs'>
                    No channels available for this Slack workspace.
                  </p>
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
                      <SlackIcon className='h-4 w-4 text-[#611f69]' />
                      {getChannelIcon(channel)}
                      <span className='truncate font-normal'>{formatChannelName(channel)}</span>
                      {channel.isPrivate && (
                        <span className='ml-auto text-muted-foreground text-xs'>Private</span>
                      )}
                    </div>
                    {channel.id === value && <Check className='ml-auto h-4 w-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
