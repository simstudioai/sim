import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { GmailIcon } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Logger } from '@/lib/logs/console-logger'
import { JSONView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components/json-view/json-view'
import { ConfigSection } from '../ui/config-section'

const logger = new Logger('GmailConfig')

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

const getExampleEmailEvent = (includeRawEmail: boolean) => {
  const baseExample = {
    email: {
      id: '18e0ffabd5b5a0f4',
      threadId: '18e0ffabd5b5a0f4',
      subject: 'Monthly Report - April 2025',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      cc: 'team@example.com',
      date: '2025-05-10T10:15:23.000Z',
      bodyText:
        'Hello,\n\nPlease find attached the monthly report for April 2025.\n\nBest regards,\nSender',
      bodyHtml:
        '<div><p>Hello,</p><p>Please find attached the monthly report for April 2025.</p><p>Best regards,<br>Sender</p></div>',
      labels: ['INBOX', 'IMPORTANT'],
      hasAttachments: true,
      attachments: [
        {
          filename: 'report-april-2025.pdf',
          mimeType: 'application/pdf',
          size: 2048576,
        },
      ],
    },
    timestamp: '2025-05-10T10:15:30.123Z',
  }

  if (includeRawEmail) {
    return {
      ...baseExample,
      rawEmail: {
        id: '18e0ffabd5b5a0f4',
        threadId: '18e0ffabd5b5a0f4',
        labelIds: ['INBOX', 'IMPORTANT'],
        snippet: 'Hello, Please find attached the monthly report...',
        historyId: '123456',
        internalDate: '1715337323000',
        payload: {
          partId: '',
          mimeType: 'multipart/mixed',
          filename: '',
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'recipient@example.com' },
            { name: 'Subject', value: 'Monthly Report - April 2025' },
            { name: 'Date', value: 'Fri, 10 May 2025 10:15:23 +0000' },
            { name: 'Message-ID', value: '<abc123@example.com>' },
          ],
          body: { size: 0 },
          parts: [
            {
              partId: '0',
              mimeType: 'text/plain',
              filename: '',
              headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }],
              body: {
                size: 85,
                data: 'SGVsbG8sDQoNClBsZWFzZSBmaW5kIGF0dGFjaGVkIHRoZSBtb250aGx5IHJlcG9ydA==',
              },
            },
          ],
        },
        sizeEstimate: 4156,
      },
    }
  }

  return baseExample
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-1 text-gray-500'
                aria-label='Learn more about email labels'
              >
                <Info className='h-4 w-4' />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side='right'
              align='center'
              className='z-[100] max-w-[300px] p-3'
              role='tooltip'
            >
              <p className='text-sm'>{TOOLTIPS.labels}</p>
            </TooltipContent>
          </Tooltip>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-6 w-6 p-1 text-gray-500'
                  aria-label='Learn more about label filter behavior'
                >
                  <Info className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side='right'
                align='center'
                className='z-[100] max-w-[300px] p-3'
                role='tooltip'
              >
                <p className='text-sm'>{TOOLTIPS.labelFilter}</p>
              </TooltipContent>
            </Tooltip>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-1 text-gray-500'
                    aria-label='Learn more about marking emails as read'
                  >
                    <Info className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top' align='center' className='z-[100] max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.markAsRead}</p>
                </TooltipContent>
              </Tooltip>
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 w-6 p-1 text-gray-500'
                    aria-label='Learn more about raw email data'
                  >
                    <Info className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='top' align='center' className='z-[100] max-w-[300px] p-3'>
                  <p className='text-sm'>{TOOLTIPS.includeRawEmail}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </ConfigSection>

      <Notice
        variant='default'
        className='border-slate-200 bg-white dark:border-border dark:bg-background'
        icon={<GmailIcon className='mt-0.5 mr-3.5 h-5 w-5 flex-shrink-0 text-red-500' />}
        title='Gmail Event Payload Example'
      >
        <div className='overflow-wrap-anywhere mt-2 whitespace-normal break-normal font-mono text-sm'>
          <JSONView data={getExampleEmailEvent(includeRawEmail)} />
        </div>
      </Notice>
    </div>
  )
}
