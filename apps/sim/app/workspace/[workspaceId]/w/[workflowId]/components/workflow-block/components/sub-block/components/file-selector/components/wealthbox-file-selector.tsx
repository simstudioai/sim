'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react'
import { WealthboxIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type Credential,
  getProviderIdFromServiceId,
  getServiceIdFromScopes,
  type OAuthProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'

const logger = createLogger('WealthboxFileSelector')

export interface WealthboxItemInfo {
  id: string
  name: string
  type: 'contact'
  content?: string
  createdAt?: string
  updatedAt?: string
}

interface WealthboxFileSelectorProps {
  value: string
  onChange: (value: string, itemInfo?: WealthboxItemInfo) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  disabled?: boolean
  serviceId?: string
  showPreview?: boolean
  onFileInfoChange?: (itemInfo: WealthboxItemInfo | null) => void
  itemType?: 'contact'
  credentialId?: string
}

export function WealthboxFileSelector({
  value,
  onChange,
  provider,
  requiredScopes = [],
  label = 'Select item',
  disabled = false,
  serviceId,
  showPreview = true,
  onFileInfoChange,
  itemType = 'contact',
  credentialId,
}: WealthboxFileSelectorProps) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>(credentialId || '')
  const [selectedItemId, setSelectedItemId] = useState(value)
  const [selectedItem, setSelectedItem] = useState<WealthboxItemInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSelectedItem, setIsLoadingSelectedItem] = useState(false)
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [availableItems, setAvailableItems] = useState<WealthboxItemInfo[]>([])
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
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
    } finally {
      setIsLoading(false)
      setCredentialsLoaded(true)
    }
  }, [provider, getProviderId, selectedCredentialId])

  // Keep local credential state in sync with persisted credential
  useEffect(() => {
    if (credentialId && credentialId !== selectedCredentialId) {
      setSelectedCredentialId(credentialId)
    }
  }, [credentialId, selectedCredentialId])

  // Debounced search function
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)

  // Fetch available items for the selected credential
  const fetchAvailableItems = useCallback(async () => {
    if (!selectedCredentialId) return

    setIsLoadingItems(true)
    try {
      const queryParams = new URLSearchParams({
        credentialId: selectedCredentialId,
        type: itemType,
      })

      if (searchQuery.trim()) {
        queryParams.append('query', searchQuery.trim())
      }

      const response = await fetch(`/api/auth/oauth/wealthbox/items?${queryParams.toString()}`)

      if (response.ok) {
        const data = await response.json()
        setAvailableItems(data.items || [])
      } else {
        logger.error('Error fetching available items:', {
          error: await response.text(),
        })
        setAvailableItems([])
      }
    } catch (error) {
      logger.error('Error fetching available items:', { error })
      setAvailableItems([])
    } finally {
      setIsLoadingItems(false)
    }
  }, [selectedCredentialId, searchQuery, itemType])

  // Fetch a single item by ID
  const fetchItemById = useCallback(
    async (itemId: string) => {
      if (!selectedCredentialId || !itemId) return null

      setIsLoadingSelectedItem(true)
      try {
        const queryParams = new URLSearchParams({
          credentialId: selectedCredentialId,
          itemId: itemId,
          type: itemType,
        })

        const response = await fetch(`/api/auth/oauth/wealthbox/item?${queryParams.toString()}`)

        if (response.ok) {
          const data = await response.json()
          if (data.item) {
            setSelectedItem(data.item)
            onFileInfoChange?.(data.item)
            return data.item
          }
        } else {
          const errorText = await response.text()
          logger.error('Error fetching item by ID:', { error: errorText })

          if (response.status === 404 || response.status === 403) {
            logger.info('Item not accessible, clearing selection')
            setSelectedItemId('')
            onChange('')
            onFileInfoChange?.(null)
          }
        }
        return null
      } catch (error) {
        logger.error('Error fetching item by ID:', { error })
        return null
      } finally {
        setIsLoadingSelectedItem(false)
      }
    },
    [selectedCredentialId, itemType, onFileInfoChange, onChange]
  )

  // Fetch credentials on initial mount
  useEffect(() => {
    if (!initialFetchRef.current) {
      fetchCredentials()
      initialFetchRef.current = true
    }
  }, [fetchCredentials])

  // Fetch available items only when dropdown is opened
  useEffect(() => {
    if (selectedCredentialId && open) {
      fetchAvailableItems()
    }
  }, [selectedCredentialId, open, fetchAvailableItems])

  // Fetch the selected item metadata only once when needed
  useEffect(() => {
    if (
      value &&
      value !== selectedItemId &&
      selectedCredentialId &&
      credentialsLoaded &&
      !selectedItem &&
      !isLoadingSelectedItem
    ) {
      fetchItemById(value)
    }
  }, [
    value,
    selectedItemId,
    selectedCredentialId,
    credentialsLoaded,
    selectedItem,
    isLoadingSelectedItem,
    fetchItemById,
  ])

  // Handle search input changes with debouncing
  const handleSearchChange = useCallback(
    (newQuery: string) => {
      setSearchQuery(newQuery)

      // Clear existing timeout
      if (searchTimeout) {
        clearTimeout(searchTimeout)
      }

      // Set new timeout for search
      const timeout = setTimeout(() => {
        if (selectedCredentialId) {
          fetchAvailableItems()
        }
      }, 300) // 300ms debounce

      setSearchTimeout(timeout)
    },
    [selectedCredentialId, fetchAvailableItems, searchTimeout]
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout)
      }
    }
  }, [searchTimeout])

  // Handle selecting an item
  const handleItemSelect = (item: WealthboxItemInfo) => {
    setSelectedItemId(item.id)
    setSelectedItem(item)
    onChange(item.id, item)
    onFileInfoChange?.(item)
    setOpen(false)
    setSearchQuery('')
  }

  // Handle adding a new credential
  const handleAddCredential = () => {
    setShowOAuthModal(true)
    setOpen(false)
    setSearchQuery('')
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedItemId('')
    setSelectedItem(null)
    onChange('', undefined)
    onFileInfoChange?.(null)
  }

  const getItemTypeLabel = () => {
    switch (itemType) {
      case 'contact':
        return 'Contacts'
      default:
        return 'Contacts'
    }
  }

  return (
    <>
      <div className='space-y-2'>
        <Popover
          open={open}
          onOpenChange={(isOpen) => {
            setOpen(isOpen)
            if (!isOpen) {
              setSearchQuery('')
              if (searchTimeout) {
                clearTimeout(searchTimeout)
                setSearchTimeout(null)
              }
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='w-full justify-between'
              disabled={disabled}
            >
              {selectedItem ? (
                <div className='flex items-center gap-2 overflow-hidden'>
                  <WealthboxIcon className='h-4 w-4' />
                  <span className='truncate font-normal'>{selectedItem.name}</span>
                </div>
              ) : selectedItemId && isLoadingSelectedItem && selectedCredentialId ? (
                <div className='flex items-center gap-2'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='text-muted-foreground'>Loading...</span>
                </div>
              ) : (
                <div className='flex items-center gap-2'>
                  <WealthboxIcon className='h-4 w-4' />
                  <span className='text-muted-foreground'>{label}</span>
                </div>
              )}
              <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-[300px] p-0' align='start'>
            <Command shouldFilter={false}>
              <div className='flex items-center border-b px-3' cmdk-input-wrapper=''>
                <input
                  placeholder={`Search ${itemType}s...`}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className='flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
                />
              </div>
              <CommandList>
                <CommandEmpty>
                  {isLoadingItems ? `Loading ${itemType}s...` : `No ${itemType}s found.`}
                </CommandEmpty>

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
                          <WealthboxIcon className='h-4 w-4' />
                          <span className='font-normal'>{cred.name}</span>
                        </div>
                        {cred.id === selectedCredentialId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {availableItems.length > 0 && (
                  <CommandGroup>
                    <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                      {getItemTypeLabel()}
                    </div>
                    {availableItems.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`item-${item.id}-${item.name}`}
                        onSelect={() => handleItemSelect(item)}
                      >
                        <div className='flex items-center gap-2 overflow-hidden'>
                          <WealthboxIcon className='h-4 w-4' />
                          <div className='min-w-0 flex-1'>
                            <span className='truncate font-normal'>{item.name}</span>
                            {item.updatedAt && (
                              <div className='text-muted-foreground text-xs'>
                                Updated {new Date(item.updatedAt).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                        {item.id === selectedItemId && <Check className='ml-auto h-4 w-4' />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {credentials.length === 0 && (
                  <CommandGroup>
                    <CommandItem onSelect={handleAddCredential}>
                      <div className='flex items-center gap-2 text-foreground'>
                        <WealthboxIcon className='h-4 w-4' />
                        <span>Connect Wealthbox account</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {showPreview && selectedItem && (
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
                <WealthboxIcon className='h-4 w-4' />
              </div>
              <div className='min-w-0 flex-1 overflow-hidden'>
                <div className='flex items-center gap-2'>
                  <h4 className='truncate font-medium text-xs'>{selectedItem.name}</h4>
                  {selectedItem.updatedAt && (
                    <span className='whitespace-nowrap text-muted-foreground text-xs'>
                      {new Date(selectedItem.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className='text-muted-foreground text-xs capitalize'>{selectedItem.type}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showOAuthModal && (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => setShowOAuthModal(false)}
          toolName='Wealthbox'
          provider={provider}
          requiredScopes={requiredScopes}
          serviceId={getServiceId()}
        />
      )}
    </>
  )
}
