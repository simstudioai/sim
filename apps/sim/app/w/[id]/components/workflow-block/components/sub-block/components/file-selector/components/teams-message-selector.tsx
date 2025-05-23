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
  Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  OAuthProvider,
} from '@/lib/oauth'
import { saveToStorage } from '@/stores/workflows/persistence'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'

const logger = new Logger('teams_message_selector')

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
  credential,
  selectionType = 'team',
  initialTeamId,
}: TeamsMessageSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [teams, setTeams] = useState<TeamsMessageInfo[]>([])
  const [channels, setChannels] = useState<TeamsMessageInfo[]>([])
  const [chats, setChats] = useState<TeamsMessageInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>(credential || '')
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

  // Fetch available credentials for this provider
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
      // Get the workflowId from the URL
      const urlParts = window.location.pathname.split('/')
      const workflowId = urlParts[2] // Assuming path is /w/[id]/...

      const response = await fetch('/api/auth/oauth/microsoft-teams/teams', {
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

      logger.info(`Fetched ${teamsData.length} teams`)
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
  }, [selectedCredentialId, selectedTeamId, onMessageInfoChange])

  // Fetch channels for a selected team
  const fetchChannels = useCallback(
    async (teamId: string) => {
      if (!selectedCredentialId || !teamId) return

      setIsLoading(true)
      setError(null)

      try {
        // Get the workflowId from the URL
        const urlParts = window.location.pathname.split('/')
        const workflowId = urlParts[2] // Assuming path is /w/[id]/...

        const response = await fetch('/api/auth/oauth/microsoft-teams/channels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            credential: selectedCredentialId,
            teamId,
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

        logger.info(`Fetched ${channelsData.length} channels for team ${teamId}`)
        setChannels(channelsData)

        // If we have a selected channel ID, find it in the list
        if (selectedChannelId) {
          const channel = channelsData.find((c: TeamsMessageInfo) => c.channelId === selectedChannelId)
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
    [selectedCredentialId, selectedChannelId, onMessageInfoChange]
  )

  // Fetch chats
  const fetchChats = useCallback(async () => {
    if (!selectedCredentialId) return

    setIsLoading(true)
    setError(null)

    try {
      // Get the workflowId from the URL
      const urlParts = window.location.pathname.split('/')
      const workflowId = urlParts[2] // Assuming path is /w/[id]/...

      const response = await fetch('/api/auth/oauth/microsoft-teams/chats', {
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

      logger.info(`Fetched ${chatsData.length} chats`)
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
  }, [selectedCredentialId, selectedChatId, onMessageInfoChange])

  // Keep internal selectedCredentialId in sync with the credential prop
  useEffect(() => {
    if (credential && credential !== selectedCredentialId) {
      setSelectedCredentialId(credential)
    }
  }, [credential, selectedCredentialId])

  // Set initial team ID if provided
  useEffect(() => {
    if (initialTeamId && !selectedTeamId && selectionType === 'channel') {
      setSelectedTeamId(initialTeamId)
    }
  }, [initialTeamId, selectedTeamId, selectionType])

  // Fetch appropriate data on initial mount based on selectionType
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials();
      initialFetchRef.current = true;
    }
  }, [fetchCredentials]);

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

  // Auto-fetch channels when we have a team ID and are in channel selection mode
  useEffect(() => {
    if (selectionType === 'channel' && selectionStage === 'channel' && selectedTeamId && selectedCredentialId && channels.length === 0) {
      fetchChannels(selectedTeamId)
    }
  }, [selectionType, selectionStage, selectedTeamId, selectedCredentialId, channels.length, fetchChannels])

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
    logger.info('Channel selected', {
      channel: channel.displayName,
      channelId: channel.channelId,
      teamId: channel.teamId,
      id: channel.id
    })
    
    setSelectedChannelId(channel.channelId || '')
    setSelectedChatId('')
    setSelectedMessage(channel)
    setSelectedMessageId(channel.id)
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
    const effectiveServiceId = getServiceId()
    const providerId = getProviderId()

    // Store information about the required connection
    saveToStorage<string>('pending_service_id', effectiveServiceId)
    saveToStorage<string[]>('pending_oauth_scopes', requiredScopes)
    saveToStorage<string>('pending_oauth_return_url', window.location.href)
    saveToStorage<string>('pending_oauth_provider_id', providerId)

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
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Teams
          </div>
          {teams.map((team) => (
            <CommandItem
              key={team.id}
              value={`team-${team.id}-${team.displayName}`}
              onSelect={() => handleSelectTeam(team)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <MicrosoftTeamsIcon className="h-4 w-4" />
                <span className="font-normal truncate">{team.displayName}</span>
              </div>
              {team.teamId === selectedTeamId && <Check className="ml-auto h-4 w-4" />}
            </CommandItem>
          ))}
        </CommandGroup>
      );
    }

    if (selectionStage === 'channel' && channels.length > 0) {
      return (
        <CommandGroup>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Channels
          </div>
          {channels.map((channel) => (
            <CommandItem
              key={channel.id}
              value={`channel-${channel.id}-${channel.displayName}`}
              onSelect={() => handleSelectChannel(channel)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <MicrosoftTeamsIcon className="h-4 w-4" />
                <span className="font-normal truncate">{channel.displayName}</span>
              </div>
              {channel.channelId === selectedChannelId && <Check className="ml-auto h-4 w-4" />}
            </CommandItem>
          ))}
        </CommandGroup>
      );
    }

    if (selectionStage === 'chat' && chats.length > 0) {
      return (
        <CommandGroup>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Chats
          </div>
          {chats.map((chat) => (
            <CommandItem
              key={chat.id}
              value={`chat-${chat.id}-${chat.displayName}`}
              onSelect={() => handleSelectChat(chat)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <MicrosoftTeamsIcon className="h-4 w-4" />
                <span className="font-normal truncate">{chat.displayName}</span>
              </div>
              {chat.chatId === selectedChatId && <Check className="ml-auto h-4 w-4" />}
            </CommandItem>
          ))}
        </CommandGroup>
      );
    }

    return null;
  };

  return (
    <>
      <div className="space-y-2">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
              disabled={disabled}
            >
              {selectedMessage ? (
                <div className="flex items-center gap-2 overflow-hidden">
                  <MicrosoftTeamsIcon className="h-4 w-4" />
                  <span className="font-normal truncate">{selectedMessage.displayName}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <MicrosoftTeamsIcon className="h-4 w-4" />
                  <span className="text-muted-foreground">
                    {selectionType === 'channel' && selectionStage === 'team' 
                      ? 'Select a team first'
                      : label}
                  </span>
                </div>
              )}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[300px]" align="start">
            {/* Current account indicator */}
            {selectedCredentialId && credentials.length > 0 && (
              <div className="px-3 py-2 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MicrosoftTeamsIcon className="h-4 w-4" />
                  <span className="text-xs text-muted-foreground">
                    {credentials.find((cred) => cred.id === selectedCredentialId)?.name ||
                      'Unknown'}
                  </span>
                </div>
                {credentials.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
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
                    <div className="flex items-center justify-center p-4">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span className="ml-2">Loading {selectionStage}s...</span>
                    </div>
                  ) : error ? (
                    <div className="p-4 text-center">
                      <p className="text-sm text-destructive">{error}</p>
                      {selectionStage === 'chat' && error.includes('teams') && (
                        <p className="text-xs text-muted-foreground mt-1">
                          There was an issue fetching chats. Please try again or connect a different account.
                        </p>
                      )}
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">No accounts connected.</p>
                      <p className="text-xs text-muted-foreground">
                        Connect a Microsoft Teams account to {selectionStage === 'chat' ? 'access your chats' : selectionStage === 'channel' ? 'see your channels' : 'continue'}.
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">No {selectionStage}s found.</p>
                      <p className="text-xs text-muted-foreground">
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
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Switch Account
                    </div>
                    {credentials.map((cred) => (
                      <CommandItem
                        key={cred.id}
                        value={`account-${cred.id}`}
                        onSelect={() => setSelectedCredentialId(cred.id)}
                      >
                        <div className="flex items-center gap-2">
                          <MicrosoftTeamsIcon className="h-4 w-4" />
                          <span className="font-normal">{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className="ml-auto h-4 w-4" />}
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
                      <div className="flex items-center gap-2 text-primary">
                        <MicrosoftTeamsIcon className="h-4 w-4" />
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
          <div className="mt-2 rounded-md border border-muted bg-muted/10 p-2 relative">
            <div className="absolute top-2 right-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 hover:bg-muted"
                onClick={handleClearSelection}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex items-center gap-3 pr-4">
              <div className="flex-shrink-0 flex items-center justify-center h-6 w-6 bg-muted/20 rounded">
                <MicrosoftTeamsIcon className="h-4 w-4" />
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-medium truncate">{selectedMessage.displayName}</h4>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {selectedMessage.type}
                  </span>
                </div>
                {selectedMessage.webViewLink ? (
                  <a
                    href={selectedMessage.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Microsoft Teams</span>
                    <ExternalLink className="h-3 w-3" />
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
          toolName="Microsoft Teams"
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
