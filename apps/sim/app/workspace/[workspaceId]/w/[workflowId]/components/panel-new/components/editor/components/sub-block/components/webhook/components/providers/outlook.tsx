import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import {
  Badge,
  Button,
  Checkbox,
  Label,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { ConfigSection } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/webhook/components'

const logger = createLogger('OutlookConfig')

interface OutlookFolder {
  id: string
  name: string
  type: string
  messagesTotal: number
  messagesUnread: number
}

const TOOLTIPS = {
  folders:
    'Select which Outlook folders to monitor for new emails. Common folders include Inbox, Sent Items, Drafts, etc.',
  folderFilterBehavior:
    'Choose whether to include emails from the selected folders or exclude them from monitoring.',
  markAsRead: 'Automatically mark emails as read after they are processed by the workflow.',
  includeRawEmail:
    'Include the complete, unprocessed email data from Outlook in the webhook payload. This provides access to all email metadata and headers.',
}

// Generate example payload for Outlook

interface OutlookConfigProps {
  selectedLabels: string[]
  setSelectedLabels: (folders: string[]) => void
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE'
  setLabelFilterBehavior: (behavior: 'INCLUDE' | 'EXCLUDE') => void
  markAsRead?: boolean
  setMarkAsRead?: (markAsRead: boolean) => void
  includeRawEmail?: boolean
  setIncludeRawEmail?: (includeRawEmail: boolean) => void
}

export function OutlookConfig({
  selectedLabels: selectedFolders,
  setSelectedLabels: setSelectedFolders,
  labelFilterBehavior: folderFilterBehavior,
  setLabelFilterBehavior: setFolderFilterBehavior,
  markAsRead = false,
  setMarkAsRead = () => {},
  includeRawEmail = false,
  setIncludeRawEmail = () => {},
}: OutlookConfigProps) {
  const [folders, setFolders] = useState<OutlookFolder[]>([])
  const [isLoadingFolders, setIsLoadingFolders] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  // Fetch Outlook folders
  useEffect(() => {
    let mounted = true
    const fetchFolders = async () => {
      setIsLoadingFolders(true)
      setFolderError(null)

      try {
        const credentialsResponse = await fetch('/api/auth/oauth/credentials?provider=outlook')
        if (!credentialsResponse.ok) {
          throw new Error('Failed to get Outlook credentials')
        }

        const credentialsData = await credentialsResponse.json()
        if (!credentialsData.credentials || !credentialsData.credentials.length) {
          throw new Error('No Outlook credentials found')
        }

        const credentialId = credentialsData.credentials[0].id

        const response = await fetch(`/api/tools/outlook/folders?credentialId=${credentialId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch Outlook folders')
        }

        const data = await response.json()
        if (data.folders && Array.isArray(data.folders)) {
          if (mounted) setFolders(data.folders)
        } else {
          throw new Error('Invalid folders data format')
        }
      } catch (error) {
        logger.error('Error fetching Outlook folders:', error)
        if (mounted) {
          setFolderError(error instanceof Error ? error.message : 'Failed to fetch folders')
          // Set default folders if API fails
          setFolders([
            { id: 'inbox', name: 'Inbox', type: 'folder', messagesTotal: 0, messagesUnread: 0 },
            {
              id: 'sentitems',
              name: 'Sent Items',
              type: 'folder',
              messagesTotal: 0,
              messagesUnread: 0,
            },
            { id: 'drafts', name: 'Drafts', type: 'folder', messagesTotal: 0, messagesUnread: 0 },
            {
              id: 'deleteditems',
              name: 'Deleted Items',
              type: 'folder',
              messagesTotal: 0,
              messagesUnread: 0,
            },
          ])
        }
      } finally {
        if (mounted) setIsLoadingFolders(false)
      }
    }

    fetchFolders()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className='space-y-6'>
      <ConfigSection>
        <div className='mb-3 flex items-center gap-2'>
          <h3 className='font-medium text-sm'>Email Folders to Monitor</h3>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-1 text-gray-500'
                aria-label='Learn more about email folders'
              >
                <Info className='h-4 w-4' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content
              side='right'
              align='center'
              className='z-[100] max-w-[300px] p-3'
              role='tooltip'
            >
              <p className='text-sm'>{TOOLTIPS.folders}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        </div>

        {isLoadingFolders ? (
          <div className='space-y-2'>
            <Skeleton className='h-8 w-full' />
            <Skeleton className='h-8 w-full' />
          </div>
        ) : folderError ? (
          <Notice variant='warning' className='mb-4'>
            <div className='flex items-start gap-2'>
              <Info className='mt-0.5 h-4 w-4 flex-shrink-0' />
              <div>
                <p className='font-medium text-sm'>Unable to load Outlook folders</p>
                <p className='text-sm'>{folderError}</p>
                <p className='mt-1 text-sm'>
                  Using default folders. You can still configure the webhook.
                </p>
              </div>
            </div>
          </Notice>
        ) : null}

        <div className='space-y-3'>
          <div className='flex flex-wrap gap-2'>
            {folders.map((folder) => {
              const isSelected = selectedFolders.includes(folder.id)
              return (
                <Badge
                  key={folder.id}
                  variant={isSelected ? 'default' : 'secondary'}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-primary text-muted-foreground hover:bg-primary/90'
                      : 'hover:bg-secondary/80'
                  }`}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedFolders(selectedFolders.filter((id) => id !== folder.id))
                    } else {
                      setSelectedFolders([...selectedFolders, folder.id])
                    }
                  }}
                >
                  {folder.name}
                </Badge>
              )
            })}
          </div>

          <div className='flex items-center gap-4'>
            <div className='flex items-center gap-2'>
              <Label htmlFor='folder-filter-behavior' className='font-normal text-sm'>
                Folder behavior:
              </Label>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-1 text-gray-500'
                    aria-label='Learn more about folder filter behavior'
                  >
                    <Info className='h-4 w-4' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' align='center' className='z-[100] max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.folderFilterBehavior}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
            <Select value={folderFilterBehavior} onValueChange={setFolderFilterBehavior}>
              <SelectTrigger className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='INCLUDE'>Include</SelectItem>
                <SelectItem value='EXCLUDE'>Exclude</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </ConfigSection>

      <ConfigSection>
        <div className='mb-3'>
          <h3 className='font-medium text-sm'>Email Processing Options</h3>
        </div>

        <div className='space-y-4'>
          <div className='flex items-center'>
            <div className='flex flex-1 items-center gap-2'>
              <Checkbox
                id='mark-as-read'
                checked={markAsRead}
                onCheckedChange={(checked) => setMarkAsRead(checked as boolean)}
              />
              <Label htmlFor='mark-as-read' className='cursor-pointer font-normal text-sm'>
                Mark emails as read after processing
              </Label>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-1 text-gray-500'
                    aria-label='Learn more about marking emails as read'
                  >
                    <Info className='h-4 w-4' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' align='center' className='z-[100] max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.markAsRead}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
          </div>

          <div className='flex items-center'>
            <div className='flex flex-1 items-center gap-2'>
              <Checkbox
                id='include-raw-email'
                checked={includeRawEmail}
                onCheckedChange={(checked) => setIncludeRawEmail(checked as boolean)}
              />
              <Label htmlFor='include-raw-email' className='cursor-pointer font-normal text-sm'>
                Include raw email data
              </Label>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-1 text-gray-500'
                    aria-label='Learn more about raw email data'
                  >
                    <Info className='h-4 w-4' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' align='center' className='z-[100] max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.includeRawEmail}</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
          </div>
        </div>
      </ConfigSection>
    </div>
  )
}
