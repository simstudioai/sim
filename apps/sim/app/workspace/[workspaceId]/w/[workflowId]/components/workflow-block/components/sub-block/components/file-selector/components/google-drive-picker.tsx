'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, FileIcon, RefreshCw, X } from 'lucide-react'
import useDrivePicker from 'react-google-drive-picker'
import { GoogleDocsIcon, GoogleSheetsIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { env } from '@/lib/env'
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

const logger = createLogger('GoogleDrivePicker')

export interface FileInfo {
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

interface GoogleDrivePickerProps {
  value: string
  onChange: (value: string, fileInfo?: FileInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  mimeTypeFilter?: string
  showPreview?: boolean
  onFileInfoChange?: (fileInfo: FileInfo | null) => void
  clientId: string
  apiKey: string
}

export function GoogleDrivePicker({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select file',
  disabled = false,
  serviceId,
  mimeTypeFilter,
  showPreview = true,
  onFileInfoChange,
  clientId,
  apiKey,
}: GoogleDrivePickerProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [credentialsLoaded, setCredentialsLoaded] = useState(false)
  const initialFetchRef = useRef(false)
  const [openPicker, _authResponse] = useDrivePicker()

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

        const response = await fetch(`/api/tools/drive/file?${queryParams.toString()}`)

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
    [selectedCredentialId, onChange, onFileInfoChange]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

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

  // Fetch the access token for the selected credential
  const fetchAccessToken = async (): Promise<string | null> => {
    if (!selectedCredentialId) {
      logger.error('No credential ID selected for Google Drive Picker')
      return null
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/auth/oauth/token?credentialId=${selectedCredentialId}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch access token: ${response.status}`)
      }

      const data = await response.json()
      return data.accessToken || null
    } catch (error) {
      logger.error('Error fetching access token:', { error })
      return null
    } finally {
      setIsLoading(false)
    }
  }

  // Handle opening the Google Drive Picker
  const handleOpenPicker = async () => {
    try {
      // First, get the access token for the selected credential
      const accessToken = await fetchAccessToken()

      if (!accessToken) {
        logger.error('Failed to get access token for Google Drive Picker')
        return
      }

      const viewIdForMimeType = () => {
        // Return appropriate view based on mime type filter
        if (mimeTypeFilter?.includes('folder')) {
          return 'FOLDERS'
        }
        if (mimeTypeFilter?.includes('spreadsheet')) {
          return 'SPREADSHEETS'
        }
        if (mimeTypeFilter?.includes('document')) {
          return 'DOCUMENTS'
        }
        return 'DOCS' // Default view
      }

      openPicker({
        clientId,
        developerKey: apiKey,
        viewId: viewIdForMimeType(),
        token: accessToken, // Use the fetched access token
        showUploadView: true,
        showUploadFolders: true,
        supportDrives: true,
        multiselect: false,
        appId: env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER,
        // Enable folder selection when mimeType is folder
        setSelectFolderEnabled: !!mimeTypeFilter?.includes('folder'),
        callbackFunction: (data) => {
          if (data.action === 'picked') {
            const file = data.docs[0]
            if (file) {
              const fileInfo: FileInfo = {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                iconLink: file.iconUrl,
                webViewLink: file.url,
                // thumbnailLink is not directly available from the picker
                thumbnailLink: file.iconUrl, // Use iconUrl as fallback
                modifiedTime: file.lastEditedUtc
                  ? new Date(file.lastEditedUtc).toISOString()
                  : undefined,
              }

              setSelectedFileId(file.id)
              setSelectedFile(fileInfo)
              onChange(file.id, fileInfo)
              onFileInfoChange?.(fileInfo)
            }
          }
        },
      })
    } catch (error) {
      logger.error('Error opening Google Drive Picker:', { error })
    }
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    // Show the OAuth modal
    setShowOAuthModal(true)
    setOpen(false)
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
  const getFileIcon = (file: FileInfo, size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      return <GoogleSheetsIcon className={iconSize} />
    }
    if (file.mimeType === 'application/vnd.google-apps.document') {
      return <GoogleDocsIcon className={iconSize} />
    }
    return <FileIcon className={`${iconSize} text-muted-foreground`} />
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
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
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
                  ) : (
                    <div className='p-4 text-center'>
                      <p className='font-medium text-sm'>Ready to select files.</p>
                      <p className='text-muted-foreground text-xs'>
                        Click the button below to open the file picker.
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
                          {getProviderIcon(cred.provider)}
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Open picker button - only show if we have credentials */}
                {credentials.length > 0 && selectedCredentialId && (
                  <CommandGroup>
                    <div className='p-2'>
                      <Button
                        className='w-full'
                        onClick={() => {
                          setOpen(false)
                          handleOpenPicker()
                        }}
                      >
                        Open Google Drive Picker
                      </Button>
                    </div>
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
                    <span>Open in Drive</span>
                    <ExternalLink className='h-3 w-3' />
                  </a>
                ) : (
                  <a
                    href={`https://drive.google.com/file/d/${selectedFile.id}/view`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-1 text-primary text-xs hover:underline'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
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
