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

const logger = createLogger('DiscordServerSelector')

export interface DiscordServerInfo {
  id: string
  name: string
  icon?: string | null
}

interface DiscordServerSelectorProps {
  value: string
  onChange: (value: string, serverInfo?: DiscordServerInfo) => void
  botToken: string
  label?: string
  disabled?: boolean
  showPreview?: boolean
}

export function DiscordServerSelector({
  value,
  onChange,
  botToken,
  label = 'Select Discord server',
  disabled = false,
  showPreview = true,
}: DiscordServerSelectorProps) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<DiscordServerInfo[]>([])
  const [selectedServerId, setSelectedServerId] = useState(value)
  const [selectedServer, setSelectedServer] = useState<DiscordServerInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  // Fetch servers from Discord API
  const fetchServers = useCallback(async () => {
    if (!botToken) {
      setError('Bot token is required')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/oauth/discord/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ botToken }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch Discord servers')
      }

      const data = await response.json()
      setServers(data.servers || [])

      // If we have a selected server ID, find the server info
      if (selectedServerId) {
        const serverInfo = data.servers?.find(
          (server: DiscordServerInfo) => server.id === selectedServerId
        )
        if (serverInfo) {
          setSelectedServer(serverInfo)
        }
      }
    } catch (error) {
      logger.error('Error fetching servers:', error)
      setError((error as Error).message)
      setServers([])
    } finally {
      setIsLoading(false)
      setInitialFetchDone(true)
    }
  }, [botToken, selectedServerId])

  // Handle open change - only fetch servers when the dropdown is opened
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    // Only fetch servers when opening the dropdown and if we have a valid token
    if (isOpen && botToken && (!initialFetchDone || servers.length === 0)) {
      fetchServers()
    }
  }

  // Fetch only the selected server info when component mounts or when selectedServerId changes
  // This is more efficient than fetching all servers
  const fetchSelectedServerInfo = useCallback(async () => {
    if (!botToken || !selectedServerId) return

    setIsLoading(true)
    setError(null)

    try {
      // Only fetch the specific server by ID instead of all servers
      const response = await fetch('/api/auth/oauth/discord/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          botToken,
          serverId: selectedServerId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch Discord server')
      }

      const data = await response.json()
      if (data.server) {
        setSelectedServer(data.server)
      } else if (data.servers && data.servers.length > 0) {
        const serverInfo = data.servers.find(
          (server: DiscordServerInfo) => server.id === selectedServerId
        )
        if (serverInfo) {
          setSelectedServer(serverInfo)
        }
      }
    } catch (error) {
      logger.error('Error fetching server info:', error)
      setError((error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [botToken, selectedServerId])

  // Fetch selected server info when component mounts or selectedServerId changes
  useEffect(() => {
    if (value && botToken && (!selectedServer || selectedServer.id !== value)) {
      fetchSelectedServerInfo()
    }
  }, [value, botToken, selectedServer, fetchSelectedServerInfo])

  // Sync with external value
  useEffect(() => {
    if (value !== selectedServerId) {
      setSelectedServerId(value)

      // Find server info for the new value
      if (value && servers.length > 0) {
        const serverInfo = servers.find((server) => server.id === value)
        setSelectedServer(serverInfo || null)
      } else if (value) {
        // If we have a value but no server info, we might need to fetch it
        if (!selectedServer || selectedServer.id !== value) {
          fetchSelectedServerInfo()
        }
      } else {
        setSelectedServer(null)
      }
    }
  }, [value, servers, selectedServerId, selectedServer, fetchSelectedServerInfo])

  // Handle server selection
  const handleSelectServer = (server: DiscordServerInfo) => {
    setSelectedServerId(server.id)
    setSelectedServer(server)
    onChange(server.id, server)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedServerId('')
    setSelectedServer(null)
    onChange('', undefined)
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
            className='w-full justify-between'
            disabled={disabled || !botToken}
          >
            {selectedServer ? (
              <div className='flex items-center gap-2 overflow-hidden'>
                {selectedServer.icon ? (
                  <img
                    src={selectedServer.icon}
                    alt={selectedServer.name}
                    className='h-4 w-4 rounded-full'
                  />
                ) : (
                  <DiscordIcon className='h-4 w-4' />
                )}
                <span className='truncate font-normal'>{selectedServer.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-2'>
                <DiscordIcon className='h-4 w-4' />
                <span className='text-muted-foreground'>{label}</span>
              </div>
            )}
            <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search servers...' />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading servers...</span>
                  </div>
                ) : error ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{error}</p>
                  </div>
                ) : servers.length === 0 ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No servers found</p>
                    <p className='text-muted-foreground text-xs'>
                      Make sure your bot is added to at least one server
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No matching servers</p>
                  </div>
                )}
              </CommandEmpty>

              {servers.length > 0 && (
                <CommandGroup>
                  <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                    Servers
                  </div>
                  {servers.map((server) => (
                    <CommandItem
                      key={server.id}
                      value={`server-${server.id}-${server.name}`}
                      onSelect={() => handleSelectServer(server)}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-2 overflow-hidden'>
                        {server.icon ? (
                          <img
                            src={server.icon}
                            alt={server.name}
                            className='h-4 w-4 rounded-full'
                          />
                        ) : (
                          <DiscordIcon className='h-4 w-4' />
                        )}
                        <span className='truncate font-normal'>{server.name}</span>
                      </div>
                      {server.id === selectedServerId && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Server preview */}
      {showPreview && selectedServer && (
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
              {selectedServer.icon ? (
                <img
                  src={selectedServer.icon}
                  alt={selectedServer.name}
                  className='h-4 w-4 rounded-full'
                />
              ) : (
                <DiscordIcon className='h-4 w-4' />
              )}
            </div>
            <div className='min-w-0 flex-1 overflow-hidden'>
              <h4 className='truncate font-medium text-xs'>{selectedServer.name}</h4>
              <div className='text-muted-foreground text-xs'>Server ID: {selectedServer.id}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
