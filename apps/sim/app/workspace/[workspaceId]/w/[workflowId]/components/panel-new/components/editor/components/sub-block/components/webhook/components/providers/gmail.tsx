import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import {
  Badge,
  Button,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { ConfigSection } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/webhook/components'

const logger = createLogger('GmailConfig')

const TOOLTIPS = {
  labels: 'Select which email labels to monitor.',
  labelFilter: 'Choose whether to include or exclude the selected labels.',
  markAsRead: 'Emails will be marked as read after being processed by your workflow.',
  includeRawEmail: 'Include the complete, unprocessed email data from Gmail.',
}

const FALLBACK_GMAIL_LABELS = [
  { id: 'INBOX', name: 'Inbox' },
  { id: 'SENT', name: 'Sent' },
  { id: 'IMPORTANT', name: 'Important' },
  { id: 'TRASH', name: 'Trash' },
  { id: 'SPAM', name: 'Spam' },
  { id: 'STARRED', name: 'Starred' },
]

interface GmailLabel {
  id: string
  name: string
  type?: string
  messagesTotal?: number
  messagesUnread?: number
}

const formatLabelName = (label: GmailLabel): string => {
  const formattedName = label.name.replace(/0$/, '')
  if (formattedName.startsWith('Category_')) {
    return formattedName
      .replace('Category_', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return formattedName
}

interface GmailConfigProps {
  selectedLabels: string[]
  setSelectedLabels: (labels: string[]) => void
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE'
  setLabelFilterBehavior: (behavior: 'INCLUDE' | 'EXCLUDE') => void
  markAsRead?: boolean
  setMarkAsRead?: (markAsRead: boolean) => void
  includeRawEmail?: boolean
  setIncludeRawEmail?: (includeRawEmail: boolean) => void
}

export function GmailConfig({
  selectedLabels,
  setSelectedLabels,
  labelFilterBehavior,
  setLabelFilterBehavior,
  markAsRead = false,
  setMarkAsRead = () => {},
  includeRawEmail = false,
  setIncludeRawEmail = () => {},
}: GmailConfigProps) {
  const [labels, setLabels] = useState<GmailLabel[]>([])
  const [isLoadingLabels, setIsLoadingLabels] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)

  // Fetch Gmail labels
  useEffect(() => {
    let mounted = true
    const fetchLabels = async () => {
      setIsLoadingLabels(true)
      setLabelError(null)

      try {
        const credentialsResponse = await fetch('/api/auth/oauth/credentials?provider=google-email')
        if (!credentialsResponse.ok) {
          throw new Error('Failed to get Google credentials')
        }

        const credentialsData = await credentialsResponse.json()
        if (!credentialsData.credentials || !credentialsData.credentials.length) {
          throw new Error('No Google credentials found')
        }

        const credentialId = credentialsData.credentials[0].id

        const response = await fetch(`/api/tools/gmail/labels?credentialId=${credentialId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch Gmail labels')
        }

        const data = await response.json()
        if (data.labels && Array.isArray(data.labels)) {
          if (mounted) setLabels(data.labels)
        } else {
          throw new Error('Invalid labels data format')
        }
      } catch (error) {
        logger.error('Error fetching Gmail labels:', error)
        if (mounted) {
          setLabelError('Could not fetch Gmail labels. Using default labels instead.')
          setLabels(FALLBACK_GMAIL_LABELS)
        }
      } finally {
        if (mounted) setIsLoadingLabels(false)
      }
    }

    fetchLabels()
    return () => {
      mounted = false
    }
  }, [])

  const toggleLabel = (labelId: string) => {
    if (selectedLabels.includes(labelId)) {
      setSelectedLabels(selectedLabels.filter((id) => id !== labelId))
    } else {
      setSelectedLabels([...selectedLabels, labelId])
    }
  }

  return (
    <div className='space-y-6'>
      <ConfigSection>
        <div className='mb-3 flex items-center gap-2'>
          <h3 className='font-medium text-sm'>Email Labels to Monitor</h3>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-1 text-gray-500'
                aria-label='Learn more about email labels'
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
              <p className='text-sm'>{TOOLTIPS.labels}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        </div>

        {isLoadingLabels ? (
          <div className='flex flex-wrap gap-2 py-2'>
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className='h-6 w-16 rounded-full' />
              ))}
          </div>
        ) : (
          <>
            {labelError && (
              <p className='text-amber-500 text-sm dark:text-amber-400'>{labelError}</p>
            )}

            <div className='mt-2 flex flex-wrap gap-2'>
              {labels.map((label) => (
                <Badge
                  key={label.id}
                  variant={selectedLabels.includes(label.id) ? 'default' : 'outline'}
                  className='cursor-pointer'
                  onClick={() => toggleLabel(label.id)}
                >
                  {formatLabelName(label)}
                </Badge>
              ))}
            </div>
          </>
        )}

        <div className='mt-4'>
          <div className='flex items-center gap-2'>
            <Label htmlFor='label-behavior' className='font-medium text-sm'>
              Label Filter Behavior
            </Label>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 p-1 text-gray-500'
                  aria-label='Learn more about label filter behavior'
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
                <p className='text-sm'>{TOOLTIPS.labelFilter}</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          <div className='mt-1'>
            <Select value={labelFilterBehavior} onValueChange={setLabelFilterBehavior}>
              <SelectTrigger id='label-behavior' className='w-full'>
                <SelectValue placeholder='Select behavior' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='INCLUDE'>Include selected labels</SelectItem>
                <SelectItem value='EXCLUDE'>Exclude selected labels</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </ConfigSection>

      <ConfigSection>
        <h3 className='mb-3 font-medium text-sm'>Email Processing Options</h3>

        <div className='space-y-3'>
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
