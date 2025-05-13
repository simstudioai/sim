'use client'

import { useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface SubscriptionData {
  id: string
  referenceId: string
  seats?: number | null
  periodStart?: string | Date | null
  periodEnd?: string | Date | null
  userName?: string | null
  userEmail?: string | null
  plan: string
  status?: string | null
  stripeCustomerId?: string | null
}

interface SubscriptionListProps {
  title: string
  description: string
  subscriptions: SubscriptionData[]
  loading: boolean
  showSeats?: boolean
  emptyMessage?: string
}

export function SubscriptionList({
  title,
  description,
  subscriptions,
  loading,
  showSeats = true,
  emptyMessage = 'No subscriptions found.',
}: SubscriptionListProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null)

  // Copy any value to clipboard
  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedValue(value)
      setTimeout(() => setCopiedValue(null), 2000)
    })
  }

  // Truncate ID for display
  const truncateId = (id: string) => {
    if (!id || id.length <= 8) return id || '-'
    return `${id.substring(0, 4)}...${id.substring(id.length - 4)}`
  }

  // Format date for display
  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return 'N/A'
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleDateString()
  }

  // Get detailed timestamp for tooltips
  const getDetailedTimeTooltip = (date: Date | string | null | undefined) => {
    if (!date) return 'No date specified'
    const dateObj = typeof date === 'string' ? new Date(date) : date
    return dateObj.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Copyable cell component
  const CopyableCell = ({
    value,
    displayValue,
  }: {
    value: string
    displayValue: React.ReactNode
  }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => copyToClipboard(value)}
            className="relative text-left w-full hover:text-primary transition-colors group"
          >
            <div className="flex items-center">
              {displayValue}
              {copiedValue === value && (
                <CheckIcon className="h-3 w-3 text-green-500 ml-1.5 flex-shrink-0" />
              )}
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {copiedValue === value ? 'Copied!' : 'Click to copy'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  // Status badge component
  const StatusBadge = ({ status }: { status: string | null | undefined }) => {
    const statusText = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'

    return (
      <Badge variant="outline" className={getStatusStyle(status)}>
        {statusText}
      </Badge>
    )
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-4">Loading subscriptions...</div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">{emptyMessage}</div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  {showSeats && <TableHead>Seats</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Subscription ID</TableHead>
                  <TableHead>User/Org ID</TableHead>
                  <TableHead>Stripe ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((sub) => (
                  <TableRow key={sub.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      <CopyableCell
                        value={`${sub.userName || 'Unknown'}\n${sub.userEmail || sub.referenceId}`}
                        displayValue={
                          <div>
                            <span className="font-medium">
                              {sub.userName ||
                                (sub.userEmail ? sub.userEmail.split('@')[0] : 'Unknown')}
                            </span>
                            <span className="text-xs text-muted-foreground block">
                              {sub.userEmail || (
                                <span className="italic">ID: {truncateId(sub.referenceId)}</span>
                              )}
                            </span>
                          </div>
                        }
                      />
                    </TableCell>
                    {showSeats && <TableCell>{sub.seats || '-'}</TableCell>}
                    <TableCell>
                      <StatusBadge status={sub.status} />
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">{formatDate(sub.periodEnd)}</span>
                          </TooltipTrigger>
                          <TooltipContent>{getDetailedTimeTooltip(sub.periodEnd)}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <CopyableCell
                        value={sub.id}
                        displayValue={
                          <span className="inline-flex items-center text-xs text-muted-foreground">
                            {truncateId(sub.id)}
                          </span>
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <CopyableCell
                        value={sub.referenceId}
                        displayValue={
                          <span className="inline-flex items-center text-xs text-muted-foreground">
                            {truncateId(sub.referenceId)}
                          </span>
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {sub.stripeCustomerId ? (
                        <CopyableCell
                          value={sub.stripeCustomerId}
                          displayValue={
                            <span className="inline-flex items-center text-xs text-muted-foreground">
                              {truncateId(sub.stripeCustomerId)}
                            </span>
                          }
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function getStatusStyle(status: string | null | undefined): string {
  switch (status?.toLowerCase()) {
    case 'active':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    case 'canceled':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
    case 'past_due':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    case 'trialing':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
  }
}
