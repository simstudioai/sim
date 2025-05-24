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
import { JSONView } from '@/app/w/[id]/components/panel/components/console/components/json-view/json-view'
import { ConfigSection } from '../ui/config-section'

const logger = new Logger('GmailConfig')

const TOOLTIPS = {
  labels: 'Select which email labels to monitor.',
  labelFilter: 'Choose whether to include or exclude the selected labels.',
  markAsRead: 'Emails will be marked as read after being processed by your workflow.',
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
  let formattedName = label.name.replace(/0$/, '')
  if (formattedName.startsWith('Category_')) {
    return formattedName
      .replace('Category_', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return formattedName
}

const exampleEmailEvent = {
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
    snippet: 'Hello, Please find attached the monthly report for April 2025...',
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

interface GmailConfigProps {
  selectedLabels: string[]
  setSelectedLabels: (labels: string[]) => void
  labelFilterBehavior: 'INCLUDE' | 'EXCLUDE'
  setLabelFilterBehavior: (behavior: 'INCLUDE' | 'EXCLUDE') => void
  markAsRead?: boolean
  setMarkAsRead?: (markAsRead: boolean) => void
}

export function GmailConfig({
  selectedLabels,
  setSelectedLabels,
  labelFilterBehavior,
  setLabelFilterBehavior,
  markAsRead = false,
  setMarkAsRead = () => {},
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

        const response = await fetch(`/api/auth/oauth/gmail/labels?credentialId=${credentialId}`)
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
    <div className="space-y-6">
      <ConfigSection>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-medium">Email Labels to Monitor</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-500 p-1 h-6 w-6"
                aria-label="Learn more about email labels"
              >
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              align="center"
              className="max-w-[300px] p-3 z-[100]"
              role="tooltip"
            >
              <p className="text-sm">{TOOLTIPS.labels}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {isLoadingLabels ? (
          <div className="flex flex-wrap gap-2 py-2">
            {Array(5)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-6 w-16 rounded-full" />
              ))}
          </div>
        ) : (
          <>
            {labelError && (
              <p className="text-sm text-amber-500 dark:text-amber-400">{labelError}</p>
            )}

            <div className="flex flex-wrap gap-2 mt-2">
              {labels.map((label) => (
                <Badge
                  key={label.id}
                  variant={selectedLabels.includes(label.id) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleLabel(label.id)}
                >
                  {formatLabelName(label)}
                </Badge>
              ))}
            </div>
          </>
        )}

        <div className="mt-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="label-behavior" className="text-sm font-medium">
              Label Filter Behavior
            </Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 p-1 h-6 w-6"
                  aria-label="Learn more about label filter behavior"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                align="center"
                className="max-w-[300px] p-3 z-[100]"
                role="tooltip"
              >
                <p className="text-sm">{TOOLTIPS.labelFilter}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-1">
            <Select value={labelFilterBehavior} onValueChange={setLabelFilterBehavior}>
              <SelectTrigger id="label-behavior" className="w-full">
                <SelectValue placeholder="Select behavior" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INCLUDE">Include selected labels</SelectItem>
                <SelectItem value="EXCLUDE">Exclude selected labels</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </ConfigSection>

      <ConfigSection>
        <h3 className="text-sm font-medium mb-3">Email Processing Options</h3>

        <div className="space-y-3">
          <div className="flex items-center">
            <div className="flex items-center gap-2 flex-1">
              <Checkbox
                id="mark-as-read"
                checked={markAsRead}
                onCheckedChange={(checked) => setMarkAsRead(checked as boolean)}
              />
              <Label htmlFor="mark-as-read" className="text-sm font-normal cursor-pointer">
                Mark emails as read after processing
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-gray-500 p-1 h-6 w-6"
                    aria-label="Learn more about marking emails as read"
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="center" className="max-w-[300px] p-3 z-[100]">
                  <p className="text-sm">{TOOLTIPS.markAsRead}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </ConfigSection>

      <Notice
        variant="default"
        className="bg-white border-slate-200 dark:bg-background dark:border-border"
        icon={<GmailIcon className="h-5 w-5 text-red-500 mt-0.5 mr-3.5 flex-shrink-0" />}
        title="Gmail Event Payload Example"
      >
        <div className="mt-2 text-sm font-mono break-normal whitespace-normal overflow-wrap-anywhere">
          <JSONView data={exampleEmailEvent} />
        </div>
      </Notice>
    </div>
  )
}
