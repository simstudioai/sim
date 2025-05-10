import {
  CheckIcon,
  CheckSquareIcon,
  InfoIcon,
  MailIcon,
  RotateCcwIcon,
  SquareIcon,
  UserCheckIcon,
  UserXIcon,
  XIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface WaitlistEntry {
  id: string
  email: string
  status: string
  createdAt: Date
}

interface WaitlistTableProps {
  entries: WaitlistEntry[]
  status: string
  actionLoading: string | null
  selectedEmails: Record<string, boolean>
  onToggleSelection: (email: string) => void
  onApprove: (email: string, id: string) => void
  onReject: (email: string, id: string) => void
  onResendApproval: (email: string, id: string) => void
  formatDate: (date: Date) => string
  getDetailedTimeTooltip: (date: Date) => string
}

export function WaitlistTable({
  entries,
  status,
  actionLoading,
  selectedEmails,
  onToggleSelection,
  onApprove,
  onReject,
  onResendApproval,
  formatDate,
  getDetailedTimeTooltip,
}: WaitlistTableProps) {
  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {/* Add selection checkbox column */}
            {status !== 'approved' && (
              <TableHead className="w-[60px] text-center">Select</TableHead>
            )}
            <TableHead className="w-[250px]">Email</TableHead>
            <TableHead className="w-[120px]">Status</TableHead>
            <TableHead className="w-[120px]">Date Added</TableHead>
            <TableHead className="w-[150px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id} className="hover:bg-muted/30">
              {/* Add selection checkbox */}
              {status !== 'approved' && (
                <TableCell className="text-center py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onToggleSelection(entry.email)}
                    className="p-0 h-8 w-8"
                  >
                    {selectedEmails[entry.email] ? (
                      <CheckSquareIcon className="h-5 w-5" />
                    ) : (
                      <SquareIcon className="h-5 w-5" />
                    )}
                  </Button>
                </TableCell>
              )}

              <TableCell className="font-medium">{entry.email}</TableCell>
              <TableCell>
                {/* Status badge */}
                <Badge
                  variant="outline"
                  className={`
                    ${entry.status === 'pending' ? 'bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200' : ''}
                    ${entry.status === 'approved' ? 'bg-green-100 text-green-800 border border-green-200 hover:bg-green-200' : ''}
                    ${entry.status === 'rejected' ? 'bg-red-100 text-red-800 border border-red-200 hover:bg-red-200' : ''}
                    ${entry.status === 'signed_up' ? 'bg-purple-100 text-purple-800 border border-purple-200 hover:bg-purple-200' : ''}
                  `}
                >
                  {entry.status === 'pending' && <InfoIcon className="mr-1 h-3 w-3" />}
                  {entry.status === 'approved' && <UserCheckIcon className="mr-1 h-3 w-3" />}
                  {entry.status === 'rejected' && <UserXIcon className="mr-1 h-3 w-3" />}
                  {entry.status === 'signed_up' && <CheckIcon className="mr-1 h-3 w-3" />}
                  {entry.status.charAt(0).toUpperCase() + entry.status.slice(1).replace('_', ' ')}
                </Badge>
              </TableCell>
              <TableCell>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help">{formatDate(entry.createdAt)}</span>
                    </TooltipTrigger>
                    <TooltipContent>{getDetailedTimeTooltip(entry.createdAt)}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end space-x-1.5">
                  {entry.status !== 'approved' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => onApprove(entry.email, entry.id)}
                            disabled={actionLoading === entry.id}
                            className="hover:border-green-500 hover:text-green-600 h-8 w-8"
                          >
                            {actionLoading === entry.id ? (
                              <RotateCcwIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Approve user and send access email</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {entry.status === 'approved' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onResendApproval(entry.email, entry.id)}
                            disabled={actionLoading === entry.id}
                            className="hover:border-blue-500 hover:text-blue-600 h-8 text-xs px-2"
                          >
                            {actionLoading === entry.id ? (
                              <RotateCcwIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <MailIcon className="h-3.5 w-3.5 mr-1" />
                                Resend
                              </>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Resend approval email with sign-up link</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {entry.status !== 'rejected' && entry.status !== 'approved' && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => onReject(entry.email, entry.id)}
                            disabled={actionLoading === entry.id}
                            className="hover:border-red-500 hover:text-red-600 h-8 w-8"
                          >
                            {actionLoading === entry.id ? (
                              <RotateCcwIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XIcon className="h-3.5 w-3.5 text-red-500" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Reject user</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              `https://mail.google.com/mail/?view=cm&fs=1&to=${entry.email}`
                            )
                          }
                          className="hover:border-blue-500 hover:text-blue-600 h-8 w-8"
                        >
                          <MailIcon className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Email user in Gmail</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
