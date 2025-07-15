'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, RefreshCw, X } from 'lucide-react'
import { MicrosoftExcelIcon } from '@/components/icons'
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
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceByProviderAndId,
  getServiceIdFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '../../credential-selector/components/oauth-required-modal'

const logger = createLogger('MicrosoftFileSelector')

export interface MicrosoftFileInfo {
  id: string
  name: string
  mimeType: string
  iconLink?: string
  webViewLink?: string
  thumbnailLink?: string
  createdTime?: string
  modifiedTime?: string
  size?: string
  owners?: { displayName: string; emailAddress: string }[]
}

interface MicrosoftFileSelectorProps {
  value: string
  onChange: (value: string, fileInfo?: MicrosoftFileInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  showPreview?: boolean
  onFileInfoChange?: (fileInfo: MicrosoftFileInfo | null) => void
}

export function MicrosoftFileSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select file',
  disabled = false,
  serviceId,
  showPreview = true,
  onFileInfoChange,
}: MicrosoftFileSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<MicrosoftFileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [availableFiles, setAvailableFiles] = useState<MicrosoftFileInfo[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [credentialsLoaded, setCredentialsLoaded] = useState(false)
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
    setCredentialsLoaded(false)
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
      setCredentialsLoaded(true)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Fetch available Excel files for the selected credential
  const fetchAvailableFiles = useCallback(async () => {
    if (!selectedCredentialId) return

    setIsLoadingFiles(true)
    try {
      const queryParams = new URLSearchParams({
        credentialId: selectedCredentialId,
      })

      // Add search query if provided
      if (searchQuery.trim()) {
        queryParams.append('query', searchQuery.trim())
      }

      const response = await fetch(`/api/auth/oauth/microsoft/files?${queryParams.toString()}`)

      if (response.ok) {
        const data = await response.json()
        setAvailableFiles(data.files || [])
      } else {
        logger.error('Error fetching available files:', {
          error: await response.text(),
        })
        setAvailableFiles([])
      }
    } catch (error) {
      logger.error('Error fetching available files:', { error })
      setAvailableFiles([])
    } finally {
      setIsLoadingFiles(false)
    }
  }, [selectedCredentialId, searchQuery])

  // Fetch a single file by ID when we have a selectedFileId but no metadata
  const fetchFileById = useCallback(
    async (fileId: string) => {
      if (!selectedCredentialId || !fileId) return null

      setIsLoadingSelectedFile(true)
      try {
        // Construct query parameters
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
          fileId: fileId,
        })

        const response = await fetch(`/api/auth/oauth/microsoft/file?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          if (data.file) {
            setSelectedFile(data.file)
            onFileInfoChange?.(data.file)
            return data.file
          }
        } else {
          const errorText = await response.text()
          logger.error('Error fetching file by ID:', { error: errorText })

          // If file not found or access denied, clear the selection
          if (response.status === 404 || response.status === 403) {
            logger.info('File not accessible, clearing selection')
            setSelectedFileId('')
            onChange('')
            onFileInfoChange?.(null)
          }
        }
        return null
      } catch (error) {
        logger.error('Error fetching file by ID:', { error })
        return null
      } finally {
        setIsLoadingSelectedFile(false)
      }
    },
    [selectedCredentialId, onFileInfoChange]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Fetch available files when credential changes
  useEffect(() => {
    if (selectedCredentialId) {
      fetchAvailableFiles()
    }
  }, [selectedCredentialId, fetchAvailableFiles])

  // Refetch files when search query changes
  useEffect(() => {
    if (selectedCredentialId && searchQuery !== undefined) {
      const timeoutId = setTimeout(() => {
        fetchAvailableFiles()
      }, 300) // Debounce search

      return () => clearTimeout(timeoutId)
    }
  }, [searchQuery, selectedCredentialId, fetchAvailableFiles])

  // Keep internal selectedFileId in sync with the value prop
  useEffect(() => {
    if (value !== selectedFileId) {
      const previousFileId = selectedFileId
      setSelectedFileId(value)
      // Only clear selected file info if we had a different file before (not initial load)
      if (previousFileId && previousFileId !== value && selectedFile) {
        setSelectedFile(null)
      }
    }
  }, [value, selectedFileId, selectedFile])

  // Track previous credential ID to detect changes
  const prevCredentialIdRef = useRef<string>('')

  // Clear selected file when credentials are removed or changed
  useEffect(() => {
    const prevCredentialId = prevCredentialIdRef.current
    prevCredentialIdRef.current = selectedCredentialId

    if (!selectedCredentialId) {
      // No credentials - clear everything
      if (selectedFile) {
        setSelectedFile(null)
        setSelectedFileId('')
        onChange('')
      }
    } else if (prevCredentialId && prevCredentialId !== selectedCredentialId) {
      // Credentials changed (not initial load) - clear file info to force refetch
      if (selectedFile) {
        setSelectedFile(null)
      }
    }
  }, [selectedCredentialId, selectedFile, onChange])

  // Fetch the selected file metadata once credentials are loaded or changed
  useEffect(() => {
    // Only fetch if we have both a file ID and credentials, credentials are loaded, but no file info yet
    if (
      value &&
      selectedCredentialId &&
      credentialsLoaded &&
      !selectedFile &&
      !isLoadingSelectedFile
    ) {
      fetchFileById(value)
    }
  }, [
    value,
    selectedCredentialId,
    credentialsLoaded,
    selectedFile,
    isLoadingSelectedFile,
    fetchFileById,
  ])

  // Handle selecting a file from the available files
  const handleFileSelect = (file: MicrosoftFileInfo) => {
    setSelectedFileId(file.id)
    setSelectedFile(file)
    onChange(file.id, file)
    onFileInfoChange?.(file)
    setOpen(false)
    setSearchQuery('') // Clear search when file is selected
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
    setSearchQuery('') // Clear search when closing
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedFileId('')
    setSelectedFile(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className='h-4 w-4' />
    }

    // For compound providers, find the specific service
    if (providerName.includes('-')) {
      for (const service of Object.values(baseProviderConfig.services)) {
        if (service.providerId === providerName) {
          return service.icon({ className: 'h-4 w-4' })
        }
      }
    }

    // Fallback to base provider icon
    return baseProviderConfig.icon({ className: 'h-4 w-4' })
  }

  // Get provider name
  const getProviderName = (providerName: OAuthProvider) => {
    const effectiveServiceId = getServiceId()
    try {
      // First try to get the service by provider and service ID
      const service = getServiceByProviderAndId(providerName, effectiveServiceId)
      return service.name
    } catch (_error) {
      // If that fails, try to get the service by parsing the provider
      try {
        const { baseProvider } = parseProvider(providerName)
        const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

        // For compound providers like 'google-drive', try to find the specific service
        if (providerName.includes('-')) {
          const serviceKey = providerName.split('-')[1] || ''
          for (const [key, service] of Object.entries(baseProviderConfig?.services || {})) {
            if (key === serviceKey || key === providerName || service.providerId === providerName) {
              return service.name
            }
          }
        }

        // Fallback to provider name if service not found
        if (baseProviderConfig) {
          return baseProviderConfig.name
        }
      } catch (_parseError) {
        // Ignore parse error and continue to final fallback
      }

      // Final fallback: capitalize the provider name
      return providerName
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }

  // Get file icon based on mime type
  const getFileIcon = (file: MicrosoftFileInfo, size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

    if (file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return <MicrosoftExcelIcon className={`${iconSize} text-green-600`} />
    }
    // if (file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    //   return <FileIcon className={`${iconSize} text-blue-600`} />
    // }
    // if (file.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    //   return <FileIcon className={`${iconSize} text-orange-600`} />
    // }
    // return <FileIcon className={`${iconSize} text-muted-foreground`} />
  }

  // Handle search input changes
  const handleSearch = (query: string) => {
    setSearchQuery(query)
  }

  return (
    <>
      <div className='space-y-2'>
        <Popover
          open={open}
          onOpenChange={(isOpen) => {
            setOpen(isOpen)
            if (!isOpen) {
              setSearchQuery('') // Clear search when popover closes
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='h-10 w-full min-w-0 justify-between'
              disabled={disabled}
            >
              <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
                {selectedFile ? (
                  <>
                    {getFileIcon(selectedFile, 'sm')}
                    <span className='truncate font-normal'>{selectedFile.name}</span>
                  </>
                ) : selectedFileId && isLoadingSelectedFile && selectedCredentialId ? (
                  <>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='truncate text-muted-foreground'>Loading document...</span>
                  </>
                ) : (
                  <>
                    {getProviderIcon(provider)}
                    <span className='truncate text-muted-foreground'>{label}</span>
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
                  {getProviderIcon(provider)}
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
              <CommandInput placeholder='Search Excel files...' onValueChange={handleSearch} />
              <CommandList>
                <CommandEmpty>
                  {isLoading || isLoadingFiles ? (
                    <div className='flex items-center justify-center p-4'>
                      <RefreshCw className='h-4 w-4 animate-spin' />
                      <span className='ml-2'>Loading...</span>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No accounts connected.</p>
                      <p className='text-muted-foreground text-xs'>
                        Connect a {getProviderName(provider)} account to continue.
                      </p>
                    </div>
                  ) : availableFiles.length === 0 ? (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>No Excel files found.</p>
                      <p className='text-muted-foreground text-xs'>
                        No .xlsx files were found in your OneDrive.
                      </p>
                    </div>
                  ) : null}
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
                          {getProviderIcon(cred.provider)}
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Available Excel files - only show if we have credentials and files */}
                {credentials.length > 0 && selectedCredentialId && availableFiles.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      Excel Files
                    </div>
                    {availableFiles.map((file) => (
                      <CommandItem
                        key={file.id}
                        value={`file-${file.id}-${file.name}`}
                        onSelect={() => handleFileSelect(file)}
                      >
                        <div className='flex items-center gap-2 overflow-hidden'>
                          {getFileIcon(file, 'sm')}
                          <div className='min-w-0 flex-1'>
                            <span className='truncate font-normal'>{file.name}</span>
                            {file.modifiedTime && (
                              <div className='text-muted-foreground text-xs'>
                                Modified {new Date(file.modifiedTime).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                        {file.id === selectedFileId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className='flex items-center gap-2 text-primary'>
                        {getProviderIcon(provider)}
                        <span>Connect {getProviderName(provider)} account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* File preview */}
        {showPreview && selectedFile && (
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
                {getFileIcon(selectedFile, 'sm')}
              </div>
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='flex items-center gap-2'>
                  <h4 className='truncate font-medium text-xs'>{selectedFile.name}</h4>
                  {selectedFile.modifiedTime && (
                    <span className='whitespace-nowrap text-muted-foreground text-xs'>
                      {new Date(selectedFile.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {selectedFile.webViewLink ? (
                  <a
                    href={selectedFile.webViewLink}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in OneDrive</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <a
                    href={`https://graph.microsoft.com/v1.0/me/drive/items/${selectedFile.id}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in OneDrive</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
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
          toolName={getProviderName(provider)}
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
