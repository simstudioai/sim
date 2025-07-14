'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw, X } from 'lucide-react'
import { MicrosoftTeamsIcon } from '@/components/icons'
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
import { Logger } from '@/lib/logs/console-logger'
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  type OAuthProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'

const logger = new Logger('TeamsMessageSelector')

export interface TeamsMessageInfo {
  id: string
  displayName: string
  type: 'team' | 'channel' | 'chat'
  teamId?: string
  channelId?: string
  chatId?: string
  webViewLink?: string
}

interface TeamsMessageSelectorProps {
  value: string
  onChange: (value: string, messageInfo?: TeamsMessageInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  showPreview?: boolean
  onMessageInfoChange?: (messageInfo: TeamsMessageInfo | null) => void
  credential: string
  selectionType?: 'team' | 'channel' | 'chat'
  initialTeamId?: string
  workflowId: string
}

export function TeamsMessageSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select Teams message location',
  disabled = false,
  serviceId,
  showPreview = true,
  onMessageInfoChange,
  selectionType = 'team',
  initialTeamId,
  workflowId,
}: TeamsMessageSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [teams, setTeams] = useState<TeamsMessageInfo[]>([])
  const [channels, setChannels] = useState<TeamsMessageInfo[]>([])
  const [chats, setChats] = useState<TeamsMessageInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [selectedChatId, setSelectedChatId] = useState<string>('')
  const [selectedMessageId, setSelectedMessageId] = useState(value)
  const [selectedMessage, setSelectedMessage] = useState<TeamsMessageInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const initialFetchRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [selectionStage, setSelectionStage] = useState<'team' | 'channel' | 'chat'>(selectionType)

  // Determine the appropriate service ID based on provider and scopes
  const getServiceId = (): string => {
    if (serviceId) return serviceId
    return getServiceIdFromScopes(provider, requiredScopes)
  }

  // Determine the appropriate provider ID based on service and scopes
  const getProviderId = (): string => {
    const effectiveServiceId = getServiceId()
    return getProviderIdFromServiceId(effectiveServiceId)
  }

  const fetchCredentials = useCallback(async () => {
    setIsLoading(true)
    try {
      const providerId = getProviderId()
      const response = await fetch(`/api/auth/oauth/credentials?provider=${providerId}`)

      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials)

        // Auto-select logic for credentials
        if (data.credentials.length > 0) {
          // If we already have a selected credential ID, check if it's valid
          if (
            selectedCredentialId &&
            data.credentials.some((cred: Credential) => cred.id === selectedCredentialId)
          ) {
            // Keep the current selection
          } else {
            // Otherwise, select the default or first credential
            const defaultCred = data.credentials.find((cred: Credential) => cred.isDefault)
            if (defaultCred) {
              setSelectedCredentialId(defaultCred.id)
            } else if (data.credentials.length === 1) {
              setSelectedCredentialId(data.credentials[0].id)
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching credentials:', error)
    } finally {
      setIsLoading(false)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Fetch teams
  const fetchTeams = useCallback(async () => {
    if (!selectedCredentialId) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/tools/microsoft-teams/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credential: selectedCredentialId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()

        // If server indicates auth is required, show the auth modal
        if (response.status === 401 && errorData.authRequired) {
          logger.warn('Authentication required for Microsoft Teams')
          setShowOAuthModal(true)
          throw new Error('Microsoft Teams authentication required')
        }

        throw new Error(errorData.error || 'Failed to fetch teams')
      }

      const data = await response.json()
      const teamsData = data.teams.map((team: { id: string; displayName: string }) => ({
        id: team.id,
        displayName: team.displayName,
        type: 'team' as const,
        teamId: team.id,
        webViewLink: `https://teams.microsoft.com/l/team/${team.id}`,
      }))

      setTeams(teamsData)

      // If we have a selected team ID, find it in the list
      if (selectedTeamId) {
        const team = teamsData.find((t: TeamsMessageInfo) => t.teamId === selectedTeamId)
        if (team) {
          setSelectedMessage(team)
          onMessageInfoChange?.(team)
        }
      }
    } catch (error) {
      logger.error('Error fetching teams:', error)
      setError((error as Error).message)
      setTeams([])
    } finally {
      setIsLoading(false)
    }
  }, [selectedCredentialId, selectedTeamId, onMessageInfoChange, workflowId])

  // Fetch channels for a selected team
  const fetchChannels = useCallback(
    async (teamId: string) => {
      if (!selectedCredentialId || !teamId) return

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/tools/microsoft-teams/channels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            credential: selectedCredentialId,
            teamId,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()

          // If server indicates auth is required, show the auth modal
          if (response.status === 401 && errorData.authRequired) {
            logger.warn('Authentication required for Microsoft Teams')
            setShowOAuthModal(true)
            throw new Error('Microsoft Teams authentication required')
          }

          throw new Error(errorData.error || 'Failed to fetch channels')
        }

        const data = await response.json()
        const channelsData = data.channels.map((channel: { id: string; displayName: string }) => ({
          id: `${teamId}-${channel.id}`,
          displayName: channel.displayName,
          type: 'channel' as const,
          teamId,
          channelId: channel.id,
          webViewLink: `https://teams.microsoft.com/l/channel/${teamId}/${encodeURIComponent(channel.displayName)}/${channel.id}`,
        }))

        setChannels(channelsData)

        // If we have a selected channel ID, find it in the list
        if (selectedChannelId) {
          const channel = channelsData.find(
            (c: TeamsMessageInfo) => c.channelId === selectedChannelId
          )
          if (channel) {
            setSelectedMessage(channel)
            onMessageInfoChange?.(channel)
          }
        }
      } catch (error) {
        logger.error('Error fetching channels:', error)
        setError((error as Error).message)
        setChannels([])
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, selectedChannelId, onMessageInfoChange, workflowId]
  )

  // Fetch chats
  const fetchChats = useCallback(async () => {
    if (!selectedCredentialId) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/tools/microsoft-teams/chats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credential: selectedCredentialId,
          workflowId: workflowId, // Pass the workflowId for server-side authentication
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()

        // If server indicates auth is required, show the auth modal
        if (response.status === 401 && errorData.authRequired) {
          logger.warn('Authentication required for Microsoft Teams')
          setShowOAuthModal(true)
          throw new Error('Microsoft Teams authentication required')
        }

        throw new Error(errorData.error || 'Failed to fetch chats')
      }

      const data = await response.json()
      const chatsData = data.chats.map((chat: { id: string; displayName: string }) => ({
        id: chat.id,
        displayName: chat.displayName,
        type: 'chat' as const,
        chatId: chat.id,
        webViewLink: `https://teams.microsoft.com/l/chat/${chat.id}`,
      }))

      setChats(chatsData)

      // If we have a selected chat ID, find it in the list
      if (selectedChatId) {
        const chat = chatsData.find((c: TeamsMessageInfo) => c.chatId === selectedChatId)
        if (chat) {
          setSelectedMessage(chat)
          onMessageInfoChange?.(chat)
        }
      }
    } catch (error) {
      logger.error('Error fetching chats:', error)
      setError((error as Error).message)
      setChats([])
    } finally {
      setIsLoading(false)
    }
  }, [selectedCredentialId, selectedChatId, onMessageInfoChange, workflowId])

  // Update selection stage based on selected values and selectionType
  useEffect(() => {
    // If we have explicit values selected, use those to determine the stage
    if (selectedChatId) {
      setSelectionStage('chat')
    } else if (selectedChannelId) {
      setSelectionStage('channel')
    } else if (selectionType === 'channel' && selectedTeamId) {
      // If we're in channel mode and have a team selected, go to channel selection
      setSelectionStage('channel')
    } else if (selectionType !== 'team' && !selectedTeamId) {
      // If no selections but we have a specific selection type, use that
      // But for channel selection, start with team selection if no team is selected
      if (selectionType === 'channel') {
        setSelectionStage('team')
      } else {
        setSelectionStage(selectionType)
      }
    } else {
      // Default to team selection
      setSelectionStage('team')
    }
  }, [selectedTeamId, selectedChannelId, selectedChatId, selectionType])

  // Handle open change
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    // Only fetch data when opening the dropdown
    if (isOpen && selectedCredentialId) {
      if (selectionStage === 'team') {
        fetchTeams()
      } else if (selectionStage === 'channel' && selectedTeamId) {
        fetchChannels(selectedTeamId)
      } else if (selectionStage === 'chat') {
        fetchChats()
      }
    }
  }

  // Keep internal selectedMessageId in sync with the value prop
  useEffect(() => {
    if (value !== selectedMessageId) {
      setSelectedMessageId(value)
    }
  }, [value])

  // Handle team selection
  const handleSelectTeam = (team: TeamsMessageInfo) => {
    setSelectedTeamId(team.teamId || '')
    setSelectedChannelId('')
    setSelectedChatId('')
    setSelectedMessage(team)
    setSelectedMessageId(team.id)
    onChange(team.id, team)
    onMessageInfoChange?.(team)
    setSelectionStage('channel')
    fetchChannels(team.teamId || '')
    setOpen(false)
  }

  // Handle channel selection
  const handleSelectChannel = (channel: TeamsMessageInfo) => {
    setSelectedChannelId(channel.channelId || '')
    setSelectedChatId('')
    setSelectedMessage(channel)
    setSelectedMessageId(channel.channelId || '')
    onChange(channel.channelId || '', channel)
    onMessageInfoChange?.(channel)
    setOpen(false)
  }

  // Handle chat selection
  const handleSelectChat = (chat: TeamsMessageInfo) => {
    setSelectedChatId(chat.chatId || '')
    setSelectedMessage(chat)
    setSelectedMessageId(chat.id)
    onChange(chat.id, chat)
    onMessageInfoChange?.(chat)
    setOpen(false)
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedMessageId('')
    setSelectedTeamId('')
    setSelectedChannelId('')
    setSelectedChatId('')
    setSelectedMessage(null)
    setError(null)
    onChange('', undefined)
    onMessageInfoChange?.(null)
    setSelectionStage(selectionType) // Reset to the initial selection type
  }

  // Render dropdown options based on the current selection stage
  const renderSelectionOptions = () => {
    if (selectionStage === 'team' && teams.length > 0) {
      return (
        <CommandGroup>
          <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>Teams</div>
          {teams.map((team) => (
            <CommandItem
              key={team.id}
              value={`team-${team.id}-${team.displayName}`}
              onSelect={() => handleSelectTeam(team)}
            >
              <div className='flex items-center gap-2 overflow-hidden'>
                <MicrosoftTeamsIcon className='h-4 w-4' />
                <span className='truncate font-normal'>{team.displayName}</span>
              </div>
              {team.teamId === selectedTeamId && <Check className='ml-auto h-4 w-4' />}
            </CommandItem>
          ))}
        </CommandGroup>
      )
    }

    if (selectionStage === 'channel' && channels.length > 0) {
      return (
        <CommandGroup>
          <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>Channels</div>
          {channels.map((channel) => (
            <CommandItem
              key={channel.id}
              value={`channel-${channel.id}-${channel.displayName}`}
              onSelect={() => handleSelectChannel(channel)}
            >
              <div className='flex items-center gap-2 overflow-hidden'>
                <MicrosoftTeamsIcon className='h-4 w-4' />
                <span className='truncate font-normal'>{channel.displayName}</span>
              </div>
              {channel.channelId === selectedChannelId && <Check className='ml-auto h-4 w-4' />}
            </CommandItem>
          ))}
        </CommandGroup>
      )
    }

    if (selectionStage === 'chat' && chats.length > 0) {
      return (
        <CommandGroup>
          <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>Chats</div>
          {chats.map((chat) => (
            <CommandItem
              key={chat.id}
              value={`chat-${chat.id}-${chat.displayName}`}
              onSelect={() => handleSelectChat(chat)}
            >
              <div className='flex items-center gap-2 overflow-hidden'>
                <MicrosoftTeamsIcon className='h-4 w-4' />
                <span className='truncate font-normal'>{chat.displayName}</span>
              </div>
              {chat.chatId === selectedChatId && <Check className='ml-auto h-4 w-4' />}
            </CommandItem>
          ))}
        </CommandGroup>
      )
    }

    return null
  }

  // Restore team selection on page refresh
  const restoreTeamSelection = useCallback(
    async (teamId: string) => {
      if (!selectedCredentialId || !teamId || selectionType !== 'team') return

      setIsLoading(true)
      try {
        const response = await fetch('/api/tools/microsoft-teams/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: selectedCredentialId, workflowId }),
        })

        if (response.ok) {
          const data = await response.json()
          const team = data.teams.find((t: { id: string; displayName: string }) => t.id === teamId)
          if (team) {
            const teamInfo: TeamsMessageInfo = {
              id: team.id,
              displayName: team.displayName,
              type: 'team',
              teamId: team.id,
              webViewLink: `https://teams.microsoft.com/l/team/${team.id}`,
            }
            setSelectedTeamId(team.id)
            setSelectedMessage(teamInfo)
            onMessageInfoChange?.(teamInfo)
          }
        }
      } catch (error) {
        logger.error('Error restoring team selection:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, selectionType, onMessageInfoChange, workflowId]
  )

  // Restore chat selection on page refresh
  const restoreChatSelection = useCallback(
    async (chatId: string) => {
      if (!selectedCredentialId || !chatId || selectionType !== 'chat') return

      setIsLoading(true)
      try {
        const response = await fetch('/api/tools/microsoft-teams/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: selectedCredentialId, workflowId }),
        })

        if (response.ok) {
          const data = await response.json()
          const chat = data.chats.find((c: { id: string; displayName: string }) => c.id === chatId)
          if (chat) {
            const chatInfo: TeamsMessageInfo = {
              id: chat.id,
              displayName: chat.displayName,
              type: 'chat',
              chatId: chat.id,
              webViewLink: `https://teams.microsoft.com/l/chat/${chat.id}`,
            }
            setSelectedChatId(chat.id)
            setSelectedMessage(chatInfo)
            onMessageInfoChange?.(chatInfo)
          }
        }
      } catch (error) {
        logger.error('Error restoring chat selection:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, selectionType, onMessageInfoChange, workflowId]
  )

  // Restore channel selection on page refresh
  const restoreChannelSelection = useCallback(
    async (channelId: string) => {
      if (!selectedCredentialId || !channelId || selectionType !== 'channel') return

      setIsLoading(true)
      try {
        // First fetch teams to search through them
        const teamsResponse = await fetch('/api/tools/microsoft-teams/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: selectedCredentialId, workflowId }),
        })

        if (teamsResponse.ok) {
          const teamsData = await teamsResponse.json()

          // Create parallel promises for all teams to search for the channel
          const channelSearchPromises = teamsData.teams.map(
            async (team: { id: string; displayName: string }) => {
              try {
                const channelsResponse = await fetch('/api/tools/microsoft-teams/channels', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    credential: selectedCredentialId,
                    teamId: team.id,
                    workflowId,
                  }),
                })

                if (channelsResponse.ok) {
                  const channelsData = await channelsResponse.json()
                  const channel = channelsData.channels.find(
                    (c: { id: string; displayName: string }) => c.id === channelId
                  )
                  if (channel) {
                    return {
                      team,
                      channel,
                      channelInfo: {
                        id: `${team.id}-${channel.id}`,
                        displayName: channel.displayName,
                        type: 'channel' as const,
                        teamId: team.id,
                        channelId: channel.id,
                        webViewLink: `https://teams.microsoft.com/l/channel/${team.id}/${encodeURIComponent(channel.displayName)}/${channel.id}`,
                      },
                    }
                  }
                }
              } catch (error) {
                logger.warn(
                  `Error searching for channel in team ${team.id}:`,
                  error instanceof Error ? error.message : String(error)
                )
              }
              return null
            }
          )

          // Wait for all parallel requests to complete (or fail)
          const results = await Promise.allSettled(channelSearchPromises)

          // Find the first successful result that contains our channel
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
              const { channelInfo } = result.value
              setSelectedTeamId(channelInfo.teamId!)
              setSelectedChannelId(channelInfo.channelId!)
              setSelectedMessage(channelInfo)
              onMessageInfoChange?.(channelInfo)
              return // Found the channel, exit successfully
            }
          }

          // If we get here, the channel wasn't found in any team
          logger.warn(`Channel ${channelId} not found in any accessible team`)
        }
      } catch (error) {
        logger.error('Error restoring channel selection:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, selectionType, onMessageInfoChange, workflowId]
  )

  // Set initial team ID if provided
  useEffect(() => {
    if (initialTeamId && !selectedTeamId && selectionType === 'channel') {
      setSelectedTeamId(initialTeamId)
    }
  }, [initialTeamId, selectedTeamId, selectionType])

  // Clear selection when selectionType changes to allow proper restoration
  useEffect(() => {
    setSelectedMessage(null)
    setSelectedTeamId('')
    setSelectedChannelId('')
    setSelectedChatId('')
  }, [selectionType])

  // Fetch appropriate data on initial mount based on selectionType
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Restore selection based on selectionType and value
  useEffect(() => {
    if (value && selectedCredentialId && !selectedMessage) {
      if (selectionType === 'team') {
        restoreTeamSelection(value)
      } else if (selectionType === 'chat') {
        restoreChatSelection(value)
      } else if (selectionType === 'channel') {
        restoreChannelSelection(value)
      }
    }
  }, [
    value,
    selectedCredentialId,
    selectedMessage,
    selectionType,
    restoreTeamSelection,
    restoreChatSelection,
    restoreChannelSelection,
  ])

  return (
    <>
      <div className='space-y-2'>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='h-10 w-full min-w-0 justify-between'
              disabled={disabled}
            >
              <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
                {selectedMessage ? (
                  <>
                    <MicrosoftTeamsIcon className='h-4 w-4' />
                    <span className='truncate font-normal'>{selectedMessage.displayName}</span>
                  </>
                ) : (
                  <>
                    <MicrosoftTeamsIcon className='h-4 w-4' />
                    <span className='truncate text-muted-foreground'>
                      {selectionType === 'channel' && selectionStage === 'team'
                        ? 'Select a team first'
                        : label}
                    </span>
                  </>
                )}
              </div>
              <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-[300px] p-0' align='start'>
            {/* Current account indicator */}
            {selectedCredentialId && credentials.length > 0 && (
              <div className='flex items-center justify-between border-b px-3 py-2'>
                <div className='flex items-center gap-2'>
                  <MicrosoftTeamsIcon className='h-4 w-4' />
                  <span className='text-muted-foreground text-xs'>
                    {credentials.find((cred) => cred.id === selectedCredentialId)?.name ||
                      'Unknown'}
                  </span>
                </div>
                {credentials.length > 1 && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 px-2 text-xs'
                    onClick={() => setOpen(true)}
                  >
                    Switch
                  </Button>
                )}
              </div>
            )}

            <Command>
              <CommandInput placeholder={`Search ${selectionStage}s...`} />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className='flex items-center justify-center p-4'>
                      <RefreshCw className='h-4 w-4 animate-spin' />
                      <span className='ml-2'>Loading {selectionStage}s...</span>
                    </div>
                  ) : error ? (
                    <div className='p-4 text-center'>
                      <p className='text-destructive text-sm'>{error}</p>
                      {selectionStage === 'chat' && error.includes('teams') && (
                        <p className='mt-1 text-muted-foreground text-xs'>
                          There was an issue fetching chats. Please try again or connect a different
                          account.
                        </p>
                      )}
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No accounts connected.</p>
                      <p className='text-muted-foreground text-xs'>
                        Connect a Microsoft Teams account to{' '}
                        {selectionStage === 'chat'
                          ? 'access your chats'
                          : selectionStage === 'channel'
                            ? 'see your channels'
                            : 'continue'}
                        .
                      </p>
                    </div>
                  ) : (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No {selectionStage}s found.</p>
                      <p className='text-muted-foreground text-xs'>
                        {selectionStage === 'team'
                          ? 'Try a different account.'
                          : selectionStage === 'channel'
                            ? selectedTeamId
                              ? 'This team has no channels or you may not have access.'
                              : 'Please select a team first to see its channels.'
                            : 'Try a different account or check if you have any active chats.'}
                      </p>
                    </div>
                  )}
                </CommandEmpty>

                {/* Account selection - only show if we have multiple accounts */}
                {credentials.length > 1 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      Switch Account
                    </div>
                    {credentials.map((cred) => (
                      <CommandItem
                        key={cred.id}
                        value={`account-${cred.id}`}
                        onSelect={() => {
                          setSelectedCredentialId(cred.id)
                          setOpen(false)
                        }}
                      >
                        <div className='flex items-center gap-2'>
                          <MicrosoftTeamsIcon className='h-4 w-4' />
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Display appropriate options based on selection stage */}
                {renderSelectionOptions()}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className='flex items-center gap-2 text-primary'>
                        <MicrosoftTeamsIcon className='h-4 w-4' />
                        <span>Connect Microsoft Teams account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Selection preview */}
        {showPreview && selectedMessage && (
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
              <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-muted/20'>
                <MicrosoftTeamsIcon className='h-4 w-4' />
              </div>
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='flex items-center gap-2'>
                  <h4 className='truncate font-medium text-xs'>{selectedMessage.displayName}</h4>
                  <span className='whitespace-nowrap text-muted-foreground text-xs'>
                    {selectedMessage.type}
                  </span>
                </div>
                {selectedMessage.webViewLink ? (
                  <a
                    href={selectedMessage.webViewLink}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Microsoft Teams</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <></>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName='Microsoft Teams'
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
