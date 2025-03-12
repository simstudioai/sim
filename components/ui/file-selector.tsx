'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, FileIcon, RefreshCw, Search, X } from 'lucide-react'
import { GoogleDocsIcon, GoogleSheetsIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { OAuthRequiredModal } from '@/components/ui/oauth-required-modal'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console-logger'
import {
  Credential,
  OAUTH_PROVIDERS,
  OAuthProvider,
  getProviderIdFromServiceId,
  getServiceByProviderAndId,
  getServiceIdFromScopes,
  parseProvider,
} from '@/lib/oauth'
import { saveToStorage } from '@/stores/workflows/persistence'

const logger = createLogger('FileSelector')

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

interface FileSelectorProps {
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
}

export function FileSelector({
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
}: FileSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [files, setFiles] = useState<FileInfo[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')
  const [selectedFileId, setSelectedFileId] = useState(value)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedFile, setIsLoadingSelectedFile] = useState(false)
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

        const response = await fetch(`/api/auth/oauth/drive/file?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          if (data.file) {
            setSelectedFile(data.file)
            onFileInfoChange?.(data.file)
            return data.file
          }
        } else {
          logger.error('Error fetching file by ID:', { error: await response.text() })
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

  // Fetch files from Google Drive
  const fetchFiles = useCallback(
    async (searchQuery?: string) => {
      if (!selectedCredentialId) return

      setIsLoading(true)
      try {
        // Construct query parameters
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
        })

        if (mimeTypeFilter) {
          queryParams.append('mimeType', mimeTypeFilter)
        }

        if (searchQuery) {
          queryParams.append('query', searchQuery)
        }

        const response = await fetch(`/api/auth/oauth/drive/files?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          setFiles(data.files || [])

          // If we have a selected file ID, find the file info
          if (selectedFileId) {
            const fileInfo = data.files.find((file: FileInfo) => file.id === selectedFileId)
            if (fileInfo) {
              setSelectedFile(fileInfo)
              onFileInfoChange?.(fileInfo)
            } else if (!searchQuery) {
              // Only try to fetch by ID if this is not a search query
              // and we couldn't find the file in the list
              fetchFileById(selectedFileId)
            }
          }
        } else {
          logger.error('Error fetching files:', { error: await response.text() })
          setFiles([])
        }
      } catch (error) {
        logger.error('Error fetching files:', { error })
        setFiles([])
      } finally {
        setIsLoading(false)
      }
    },
    [selectedCredentialId, mimeTypeFilter, selectedFileId, onFileInfoChange, fetchFileById]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Fetch files when credential is selected
  useEffect(() => {
    if (selectedCredentialId) {
      fetchFiles()
    }
  }, [selectedCredentialId, fetchFiles])

  // Update selected file when value changes externally
  useEffect(() => {
    if (value !== selectedFileId) {
      setSelectedFileId(value)

      // Find file info if we have files loaded
      if (files.length > 0) {
        const fileInfo = files.find((file) => file.id === value) || null
        setSelectedFile(fileInfo)
        onFileInfoChange?.(fileInfo)
      } else if (value && selectedCredentialId) {
        // If we have a value but no files loaded yet, try to fetch the file by ID
        fetchFileById(value)
      }
    }
  }, [value, files, onFileInfoChange, selectedCredentialId, fetchFileById])

  // Try to fetch the file by ID when credentials become available
  useEffect(() => {
    if (selectedCredentialId && selectedFileId && !selectedFile) {
      fetchFileById(selectedFileId)
    }
  }, [selectedCredentialId, selectedFileId, selectedFile, fetchFileById])

  // Handle file selection
  const handleSelectFile = (file: FileInfo) => {
    setSelectedFileId(file.id)
    setSelectedFile(file)
    onChange(file.id, file)
    onFileInfoChange?.(file)
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

  // Get provider icon
  const getProviderIcon = (providerName: OAuthProvider) => {
    const { baseProvider } = parseProvider(providerName)
    const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

    if (!baseProviderConfig) {
      return <ExternalLink className="h-4 w-4" />
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
    } catch (error) {
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
      } catch (parseError) {
        // Ignore parse error and continue to final fallback
      }

      // Final fallback: capitalize the provider name
      return providerName
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedFileId('')
    setSelectedFile(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  // Handle search
  const handleSearch = (value: string) => {
    if (value.length > 2) {
      fetchFiles(value)
    } else if (value.length === 0) {
      fetchFiles()
    }
  }

  // Get file icon based on mime type
  const getFileIcon = (file: FileInfo, size: 'sm' | 'md' = 'sm') => {
    const iconSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      return <GoogleSheetsIcon className={iconSize} />
    } else if (file.mimeType === 'application/vnd.google-apps.document') {
      return <GoogleDocsIcon className={iconSize} />
    }
    return <FileIcon className={`${iconSize} text-muted-foreground`} />
  }

  return (
    <>
      <div className="space-y-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
              disabled={disabled}
            >
              {selectedFile ? (
                <div className="flex items-center gap-2 overflow-hidden">
                  {getFileIcon(selectedFile, 'sm')}
                  <span className="font-normal truncate">{selectedFile.name}</span>
                </div>
              ) : selectedFileId && (isLoadingSelectedFile || !selectedCredentialId) ? (
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span className="text-muted-foreground">Loading document...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {getProviderIcon(provider)}
                  <span className="text-muted-foreground">{label}</span>
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
                  {getProviderIcon(provider)}
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
              <CommandInput placeholder="Search files..." onValueChange={handleSearch} />
              <CommandList>
                <CommandEmpty>
                  {isLoading ? (
                    <div className="flex items-center justify-center p-4">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span className="ml-2">Loading files...</span>
                    </div>
                  ) : credentials.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">No accounts connected.</p>
                      <p className="text-xs text-muted-foreground">
                        Connect a {getProviderName(provider)} account to continue.
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-sm font-medium">No files found.</p>
                      <p className="text-xs text-muted-foreground">
                        Try a different search or account.
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
                          {getProviderIcon(cred.provider)}
                          <span className="font-normal">{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Files list */}
                {files.length > 0 && (
                  <CommandGroup>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Files
                    </div>
                    {files.map((file) => (
                      <CommandItem
                        key={file.id}
                        value={`file-${file.id}-${file.name}`}
                        onSelect={() => handleSelectFile(file)}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {getFileIcon(file, 'sm')}
                          <span className="font-normal truncate">{file.name}</span>
                        </div>
                        {file.id === selectedFileId && <Check className="ml-auto h-4 w-4" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Connect account option - only show if no credentials */}
                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className="flex items-center gap-2 text-primary">
                        {getProviderIcon(provider)}
                        <span>Connect {getProviderName(provider)} account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}

                {/* Add another account option */}
                {credentials.length > 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className="flex items-center gap-2 text-primary">
                        <span>Connect Another Account</span>
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
                {getFileIcon(selectedFile, 'sm')}
              </div>
              <div className="overflow-hidden flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-medium truncate">{selectedFile.name}</h4>
                  {selectedFile.modifiedTime && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(selectedFile.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {selectedFile.webViewLink ? (
                  <a
                    href={selectedFile.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <a
                    href={`https://drive.google.com/file/d/${selectedFile.id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Open in Drive</span>
                    <ExternalLink className="h-3 w-3" />
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
