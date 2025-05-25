'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { GmailIcon, OutlookIcon } from '@/components/icons'
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
import { type Credential, getProviderIdFromServiceId, getServiceIdFromScopes } from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/w/[id]/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { saveToStorage } from '@/stores/workflows/persistence'

const logger = createLogger('FolderSelector')

export interface FolderInfo {
  id: string
  name: string
  type: string
  messagesTotal?: number
  messagesUnread?: number
}

interface FolderSelectorProps {
  value: string
  onChange: (value: string, folderInfo?: FolderInfo) => void
  provider: string
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  onFolderInfoChange?: (folderInfo: FolderInfo | null) => void
}

export function FolderSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select folder',
  disabled = false,
  serviceId,
  onFolderInfoChange,
}: FolderSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFolderId, setSelectedFolderId] = useState(value)
  const [selectedFolder, setSelectedFolder] = useState<FolderInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFolder, setIsLoadingSelectedFolder] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const initialFetchRef = useRef(false)

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
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Fetch a single folder by ID when we have a selectedFolderId but no metadata
  const fetchFolderById = useCallback(
    async (folderId: string) => {
      if (!selectedCredentialId || !folderId || provider === 'outlook') return null

      setIsLoadingSelectedFolder(true)
      try {
        // Construct query parameters
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
          labelId: folderId,
        })

        const response = await fetch(`/api/auth/oauth/gmail/label?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          if (data.label) {
            setSelectedFolder(data.label)
            onFolderInfoChange?.(data.label)
            return data.label
          }
        } else {
          logger.error('Error fetching folder by ID:', {
            error: await response.text(),
          })
        }
        return null
      } catch (error) {
        logger.error('Error fetching folder by ID:', { error })
        return null
      } finally {
        setIsLoadingSelectedFolder(false)
      }
    },
    [selectedCredentialId, onFolderInfoChange, provider]
  )

  // Fetch folders from Gmail or Outlook
  const fetchFolders = useCallback(
    async (searchQuery?: string) => {
      if (!selectedCredentialId) return

      setIsLoading(true)
      try {
        // Construct query parameters
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
        })

        if (searchQuery) {
          queryParams.append('query', searchQuery)
        }

        // Determine the API endpoint based on provider
        let apiEndpoint: string
        if (provider === 'outlook') {
          apiEndpoint = `/api/auth/oauth/outlook/folders?${queryParams.toString()}`
        } else {
          // Default to Gmail
          apiEndpoint = `/api/auth/oauth/gmail/labels?${queryParams.toString()}`
        }

        const response = await fetch(apiEndpoint)

        if (response.ok) {
          const data = await response.json()
          const folderList = provider === 'outlook' ? data.folders : data.labels
          setFolders(folderList || [])

          // If we have a selected folder ID, find the folder info
          if (selectedFolderId) {
            const folderInfo = folderList.find(
              (folder: FolderInfo) => folder.id === selectedFolderId
            )
            if (folderInfo) {
              setSelectedFolder(folderInfo)
              onFolderInfoChange?.(folderInfo)
            } else if (!searchQuery && provider !== 'outlook') {
              // Only try to fetch by ID for Gmail if this is not a search query
              // and we couldn't find the folder in the list
              fetchFolderById(selectedFolderId)
            }
          }
        } else {
          logger.error('Error fetching folders:', {
            error: await response.text(),
          })
          setFolders([])
        }
      } catch (error) {
        logger.error('Error fetching folders:', { error })
        setFolders([])
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, selectedFolderId, onFolderInfoChange, fetchFolderById, provider]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Fetch folders when credential is selected
  useEffect(() => {
    if (selectedCredentialId) {
      fetchFolders()
    }
  }, [selectedCredentialId, fetchFolders])

  // Keep internal selectedFolderId in sync with the value prop
  useEffect(() => {
    if (value !== selectedFolderId) {
      setSelectedFolderId(value)
    }
  }, [value])

  // Fetch the selected folder metadata once credentials are ready (Gmail only)
  useEffect(() => {
    if (value && selectedCredentialId && !selectedFolder && provider !== 'outlook') {
      fetchFolderById(value)
    }
  }, [value, selectedCredentialId, selectedFolder, fetchFolderById, provider])

  // Handle folder selection
  const handleSelectFolder = (folder: FolderInfo) => {
    setSelectedFolderId(folder.id)
    setSelectedFolder(folder)
    onChange(folder.id, folder)
    onFolderInfoChange?.(folder)
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

  const handleSearch = (value: string) => {
    if (value.length > 2) {
      fetchFolders(value)
    } else if (value.length === 0) {
      fetchFolders()
    }
  }

  const getFolderIcon = (size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
    if (provider === 'gmail') {
      return <GmailIcon className={iconSize} />
    }
    if (provider === 'outlook') {
      return <OutlookIcon className={iconSize} />
    }
    return null
  }

  const getProviderName = () => {
    if (provider === 'outlook') return 'Outlook'
    return 'Gmail'
  }

  const getFolderLabel = () => {
    if (provider === 'outlook') return 'folders'
    return 'labels'
  }

  return (
    <>
      <div className='space-y-2'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='w-full justify-between'
              disabled={disabled}
            >
              {selectedFolder ? (
                <div className='flex items-center gap-2 overflow-hidden'>
                  {getFolderIcon('sm')}
                  <span className='truncate font-normal'>{selectedFolder.name}</span>
                </div>
              ) : (
                <div className='flex items-center gap-2'>
                  {getFolderIcon('sm')}
                  <span className='text-muted-foreground'>{label}</span>
                </div>
              )}
              <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-[300px] p-0' align='start'>
            {/* Current account indicator */}
            {selectedCredentialId && credentials.length > 0 && (
              <div className='flex items-center justify-between border-b px-3 py-2'>
                <div className='flex items-center gap-2'>
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
              <CommandInput
                placeholder={`Search ${getFolderLabel()}...`}
                onValueChange={handleSearch}
              />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className='flex items-center justify-center p-4'>
                      <RefreshCw className='h-4 w-4 animate-spin' />
                      <span className='ml-2'>Loading {getFolderLabel()}...</span>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No accounts connected.</p>
                      <p className='text-muted-foreground text-xs'>
                        Connect a {getProviderName()} account to continue.
                      </p>
                    </div>
                  ) : (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No {getFolderLabel()} found.</p>
                      <p className='text-muted-foreground text-xs'>
                        Try a different search or account.
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
                        onSelect={() => setSelectedCredentialId(cred.id)}
                      >
                        <div className='flex items-center gap-2'>
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Folders list */}
                {folders.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      {getFolderLabel().charAt(0).toUpperCase() + getFolderLabel().slice(1)}
                    </div>
                    {folders.map((folder) => (
                      <CommandItem
                        key={folder.id}
                        value={`folder-${folder.id}-${folder.name}`}
                        onSelect={() => handleSelectFolder(folder)}
                      >
                        <div className='flex w-full items-center gap-2 overflow-hidden'>
                          {getFolderIcon('sm')}
                          <span className='truncate font-normal'>{folder.name}</span>
                          {folder.id === selectedFolderId && <Check className='ml-auto h-4 w-4' />}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className='flex items-center gap-2 text-primary'>
                        <span>Connect {getProviderName()} account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          provider={provider}
          toolName={getProviderName()}
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
