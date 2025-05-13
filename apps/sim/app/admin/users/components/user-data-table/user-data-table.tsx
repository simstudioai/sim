'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, CheckIcon, CopyIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SortDirection, SortField, UserStatsEntry } from '../../stores/user-stats-store'

interface UserDataTableProps {
  users: UserStatsEntry[]
  formatNumber: (num: number) => string
  formatCurrency: (amount: number) => string
  sortField: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
}

export function UserDataTable({
  users,
  formatNumber,
  formatCurrency,
  sortField,
  sortDirection,
  onSort,
}: UserDataTableProps) {
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
    if (id.length <= 8) return id
    return `${id.substring(0, 4)}...${id.substring(id.length - 4)}`
  }

  // Get plan badge color based on subscription plan
  const getPlanBadge = (plan: string | null) => {
    if (!plan) return null

    switch (plan) {
      case 'free':
        return <Badge variant="outline">Free</Badge>
      case 'pro':
        return <Badge className="bg-purple-500">Pro</Badge>
      case 'team':
        return <Badge className="bg-indigo-500">Team</Badge>
      case 'enterprise':
        return <Badge className="bg-blue-700">Enterprise</Badge>
      default:
        return <Badge variant="outline">{plan}</Badge>
    }
  }

  // Format date for display
  const formatDate = (date: Date) => {
    const now = new Date()
    const diffInMs = now.getTime() - date.getTime()
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInDays < 1) return 'today'
    if (diffInDays === 1) return 'yesterday'
    if (diffInDays < 30) return `${diffInDays} days ago`

    return date.toLocaleDateString()
  }

  // Get detailed timestamp for tooltips
  const getDetailedTimeTooltip = (date: Date) => {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // Get sort icon based on current sort state
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-muted-foreground/50" />
    }

    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1 text-primary" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1 text-primary" />
    )
  }

  // Sortable table header component
  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className={cn('cursor-pointer select-none', sortField === field && 'text-primary')}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center">
        {children}
        {getSortIcon(field)}
      </div>
    </TableHead>
  )

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

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader field="name">User</SortableHeader>
            <TableHead>ID</TableHead>
            <SortableHeader field="totalTokensUsed">Tokens Used</SortableHeader>
            <SortableHeader field="totalCost">Cost</SortableHeader>
            <SortableHeader field="totalExecutions">Executions</SortableHeader>
            <SortableHeader field="lastActive">Last Active</SortableHeader>
            <SortableHeader field="subscriptionPlan">Plan</SortableHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user, index) => (
            <TableRow key={`${user.id}-${index}`}>
              <TableCell className="font-medium">
                <CopyableCell
                  value={`${user.name}\n${user.email}`}
                  displayValue={
                    <div>
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{user.email}</span>
                    </div>
                  }
                />
              </TableCell>
              <TableCell>
                <CopyableCell
                  value={user.id}
                  displayValue={
                    <span className="inline-flex items-center text-xs text-muted-foreground">
                      {truncateId(user.id)}
                    </span>
                  }
                />
              </TableCell>
              <TableCell>
                <CopyableCell
                  value={user.totalTokensUsed.toString()}
                  displayValue={formatNumber(user.totalTokensUsed)}
                />
              </TableCell>
              <TableCell>
                <CopyableCell
                  value={formatCurrency(user.totalCost)}
                  displayValue={formatCurrency(user.totalCost)}
                />
              </TableCell>
              <TableCell>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `${formatNumber(
                              user.totalManualExecutions +
                                user.totalWebhookTriggers +
                                user.totalScheduledExecutions +
                                user.totalApiCalls +
                                user.totalChatExecutions
                            )}`
                          )
                        }
                        className="relative text-left w-full hover:text-primary transition-colors group"
                      >
                        <div className="flex items-center">
                          {formatNumber(
                            user.totalManualExecutions +
                              user.totalWebhookTriggers +
                              user.totalScheduledExecutions +
                              user.totalApiCalls +
                              user.totalChatExecutions
                          )}
                          {copiedValue ===
                            `${formatNumber(
                              user.totalManualExecutions +
                                user.totalWebhookTriggers +
                                user.totalScheduledExecutions +
                                user.totalApiCalls +
                                user.totalChatExecutions
                            )}` && (
                            <CheckIcon className="h-3 w-3 text-green-500 ml-1.5 flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="space-y-1 text-xs">
                        <div>Manual: {formatNumber(user.totalManualExecutions)}</div>
                        <div>Webhook: {formatNumber(user.totalWebhookTriggers)}</div>
                        <div>Scheduled: {formatNumber(user.totalScheduledExecutions)}</div>
                        <div>API: {formatNumber(user.totalApiCalls)}</div>
                        <div>Chat: {formatNumber(user.totalChatExecutions)}</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => copyToClipboard(formatDate(user.lastActive))}
                        className="relative text-left w-full hover:text-primary transition-colors group"
                      >
                        <div className="flex items-center">
                          {formatDate(user.lastActive)}
                          {copiedValue === formatDate(user.lastActive) && (
                            <CheckIcon className="h-3 w-3 text-green-500 ml-1.5 flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{getDetailedTimeTooltip(user.lastActive)}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell>
                <CopyableCell
                  value={user.subscriptionPlan || 'none'}
                  displayValue={getPlanBadge(user.subscriptionPlan)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
