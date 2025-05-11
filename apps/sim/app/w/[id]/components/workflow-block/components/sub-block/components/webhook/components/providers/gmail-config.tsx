import { useEffect, useState } from 'react'
import { GmailIcon } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
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
import { Logger } from '@/lib/logs/console-logger'
import { JSONView } from '@/app/w/[id]/components/panel/components/console/components/json-view/json-view'
import { ConfigSection } from '../ui/config-section'
import { TestResultDisplay } from '../ui/test-result'

const logger = new Logger('GmailConfig')

// Simple spinner component
const Spinner = ({ className }: { className?: string }) => (
  <div
    className={`animate-spin rounded-full border-2 border-current border-t-transparent ${className || ''}`}
  />
)

// Fallback Gmail labels in case API call fails
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

// Format category labels for better readability
const formatLabelName = (label: GmailLabel): string => {
  let formattedName = label.name.replace(/0$/, '') // Remove trailing "0" from all labels

  if (formattedName.startsWith('Category_')) {
    // Convert "Category_forums" to "Forums"
    return formattedName
      .replace('Category_', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  return formattedName
}

const exampleEmailEvent = JSON.stringify(
  {
    email: {
      id: '18e0ffabd5b5a0f4',
      threadId: '18e0ffabd5b5a0f4',
      // Basic info
      subject: 'Monthly Report - April 2025',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      cc: 'team@example.com',
      date: '2025-05-10T10:15:23.000Z',
      // Content
      bodyText:
        'Hello,\n\nPlease find attached the monthly report for April 2025.\n\nBest regards,\nSender',
      bodyHtml:
        '<div><p>Hello,</p><p>Please find attached the monthly report for April 2025.</p><p>Best regards,<br>Sender</p></div>',
      snippet: 'Hello, Please find attached the monthly report for April 2025...',
      // Metadata
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
  },
  null,
  2
)

interface GmailConfigProps {
  selectedLabels: string[]
  setSelectedLabels: (labels: string[]) => void
  labelFilterBehavior: string
  setLabelFilterBehavior: (behavior: string) => void
  processIncomingEmails: boolean
  setProcessIncomingEmails: (process: boolean) => void
  isLoadingToken: boolean
  testResult: {
    success: boolean
    message?: string
    test?: any
  } | null
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook: () => Promise<void>
  webhookUrl: string
  markAsRead?: boolean
  setMarkAsRead?: (markAsRead: boolean) => void
  singleEmailMode?: boolean
  setSingleEmailMode?: (singleMode: boolean) => void
}

export function GmailConfig({
  selectedLabels,
  setSelectedLabels,
  labelFilterBehavior,
  setLabelFilterBehavior,
  processIncomingEmails,
  setProcessIncomingEmails,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
  webhookUrl,
  markAsRead = false,
  setMarkAsRead = () => {},
  singleEmailMode = true,
  setSingleEmailMode = () => {},
}: GmailConfigProps) {
  const [labels, setLabels] = useState<GmailLabel[]>([])
  const [isLoadingLabels, setIsLoadingLabels] = useState(false)
  const [labelError, setLabelError] = useState<string | null>(null)

  // Fetch Gmail labels
  useEffect(() => {
    const fetchLabels = async () => {
      setIsLoadingLabels(true)
      setLabelError(null)

      try {
        // Get first credential ID from OAuth credentials
        const credentialsResponse = await fetch('/api/auth/oauth/credentials?provider=google-email')

        if (!credentialsResponse.ok) {
          throw new Error('Failed to get Google credentials')
        }

        const credentialsData = await credentialsResponse.json()

        if (!credentialsData.credentials || !credentialsData.credentials.length) {
          throw new Error('No Google credentials found')
        }

        const credentialId = credentialsData.credentials[0].id

        // Fetch labels using the credential
        const response = await fetch(`/api/auth/oauth/gmail/labels?credentialId=${credentialId}`)

        if (!response.ok) {
          throw new Error('Failed to fetch Gmail labels')
        }

        const data = await response.json()

        if (data.labels && Array.isArray(data.labels)) {
          setLabels(data.labels)
        } else {
          throw new Error('Invalid labels data format')
        }
      } catch (error) {
        logger.error('Error fetching Gmail labels:', error)
        setLabelError('Could not fetch Gmail labels. Using default labels instead.')
        setLabels(FALLBACK_GMAIL_LABELS)
      } finally {
        setIsLoadingLabels(false)
      }
    }

    fetchLabels()
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
      <ConfigSection title="Email Monitoring Configuration">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select which email labels to monitor. The system will automatically detect and process
            new emails in these labels.
          </p>

          {isLoadingLabels ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
          ) : (
            <>
              {labelError && (
                <p className="text-sm text-amber-500 dark:text-amber-400">{labelError}</p>
              )}

              <div className="flex flex-wrap gap-2">
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

          <div className="pt-2">
            <Label htmlFor="label-behavior" className="mb-1 block">
              Label Filter Behavior
            </Label>
            <Select value={labelFilterBehavior} onValueChange={setLabelFilterBehavior}>
              <SelectTrigger id="label-behavior" className="w-full">
                <SelectValue placeholder="Select behavior" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INCLUDE">Include selected labels</SelectItem>
                <SelectItem value="EXCLUDE">Exclude selected labels</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {labelFilterBehavior === 'INCLUDE'
                ? 'Your workflow will process emails with the selected labels.'
                : 'Your workflow will process emails without the selected labels.'}
            </p>
          </div>
        </div>
      </ConfigSection>

      <ConfigSection title="Email Processing Options">
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="process-emails"
              checked={processIncomingEmails}
              onCheckedChange={(checked) => setProcessIncomingEmails(checked as boolean)}
            />
            <Label htmlFor="process-emails" className="text-sm font-medium cursor-pointer">
              Automatically process incoming emails
            </Label>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            When new emails arrive, they will automatically trigger your workflow.
          </p>

          <div className="flex items-center space-x-2 mt-3">
            <Checkbox
              id="mark-as-read"
              checked={markAsRead}
              onCheckedChange={(checked) => setMarkAsRead(checked as boolean)}
            />
            <Label htmlFor="mark-as-read" className="text-sm font-medium cursor-pointer">
              Mark emails as read after processing
            </Label>
          </div>
          <p className="text-xs text-muted-foreground ml-6">
            Emails will be marked as read after being processed by your workflow.
          </p>
        </div>
      </ConfigSection>

      <TestResultDisplay
        testResult={testResult}
        copied={copied}
        copyToClipboard={copyToClipboard}
        showCurlCommand={false}
      />

      <Notice
        variant="default"
        className="bg-white border-slate-200 dark:bg-background dark:border-border"
        icon={<GmailIcon className="h-5 w-5 text-red-500 mt-0.5 mr-3.5 flex-shrink-0" />}
        title="Gmail Event Payload Example"
      >
        Your workflow will receive a payload similar to this when an email arrives:
        <div className="mt-2 text-sm font-mono break-normal whitespace-normal overflow-wrap-anywhere">
          <JSONView data={JSON.parse(exampleEmailEvent)} initiallyExpanded={true} />
        </div>
      </Notice>
    </div>
  )
}
