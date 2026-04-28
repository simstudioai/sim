'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@/components/emcn'
import {
  type OrgRole,
  OrgRoleSelector,
  PermissionSelector,
  type PermissionType,
} from '@/components/permissions'
import { CREDIT_MULTIPLIER, dollarsToCredits } from '@/lib/billing/credits/conversion'
import { cn } from '@/lib/core/utils/cn'
import { getUserColor } from '@/lib/workspaces/colors'
import type { Member } from '@/lib/workspaces/organization'
import { useUpdateWorkspacePermissions } from '@/hooks/queries/invitations'
import {
  type OrganizationRoster as OrganizationRosterData,
  type RosterMember,
  type RosterPendingInvitation,
  type RosterWorkspaceAccess,
  useCancelInvitation,
  useOrganizationMembers,
  useResendInvitation,
  useUpdateInvitation,
  useUpdateOrganizationMemberRole,
} from '@/hooks/queries/organization'

const logger = createLogger('OrganizationRoster')

interface OrganizationRosterProps {
  organizationId: string
  roster: OrganizationRosterData | null | undefined
  isLoadingRoster: boolean
  currentUserEmail: string
  currentUserId: string
  isAdminOrOwner: boolean
  onRemoveMember: (member: Member) => void
  onTransferOwnership?: () => void
}

function apportionCredits(
  dollarsByUser: Record<string, number>,
  totalCredits: number
): Record<string, number> {
  const entries = Object.entries(dollarsByUser).map(([userId, dollars]) => {
    const exact = dollars * CREDIT_MULTIPLIER
    return { userId, floor: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let floorSum = entries.reduce((s, e) => s + e.floor, 0)
  const gap = totalCredits - floorSum
  entries.sort((a, b) => b.remainder - a.remainder)
  for (let i = 0; i < gap && i < entries.length; i++) {
    entries[i].floor += 1
    floorSum += 1
  }
  const result: Record<string, number> = {}
  for (const e of entries) result[e.userId] = e.floor
  return result
}

function RoleBadge({ role }: { role: string }) {
  const variant = role === 'owner' ? 'blue-secondary' : 'gray-secondary'
  return (
    <Badge variant={variant} size='sm'>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </Badge>
  )
}

function MemberIdentity({
  name,
  email,
  image,
  userId,
  trailing,
}: {
  name: string
  email: string
  image?: string | null
  userId: string
  trailing?: React.ReactNode
}) {
  return (
    <div className='flex items-center gap-3'>
      <Avatar className='h-9 w-9 shrink-0'>
        {image && <AvatarImage src={image} alt={name} />}
        <AvatarFallback
          style={{ background: getUserColor(userId || email) }}
          className='border-0 text-white'
        >
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium text-[var(--text-primary)] text-base'>{name}</span>
          {trailing}
        </div>
        <div className='truncate text-[var(--text-muted)] text-small'>{email}</div>
      </div>
    </div>
  )
}

function ChevronCell({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors hover-hover:bg-[var(--surface-4)] hover-hover:text-[var(--text-primary)]'
      aria-label={expanded ? 'Collapse' : 'Expand'}
      aria-expanded={expanded}
    >
      {expanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
    </button>
  )
}

function RosterRowSkeleton() {
  return (
    <TableRow>
      <TableCell className='w-[36px]'>
        <Skeleton className='h-7 w-7 rounded-[4px]' />
      </TableCell>
      <TableCell>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-9 w-9 rounded-full' />
          <div className='flex flex-col gap-1.5'>
            <Skeleton className='h-3.5 w-28' />
            <Skeleton className='h-3 w-36' />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className='h-5 w-16 rounded-full' />
      </TableCell>
      <TableCell className='text-right'>
        <Skeleton className='ml-auto h-4 w-16' />
      </TableCell>
    </TableRow>
  )
}

function MemberExpandedPanel({
  userId,
  memberRole,
  workspaces,
  currentUserId,
  currentUserAdminWorkspaceIds,
  organizationId,
}: {
  userId: string
  memberRole: string
  workspaces: RosterWorkspaceAccess[]
  currentUserId: string
  currentUserAdminWorkspaceIds: Set<string>
  organizationId: string
}) {
  const updatePermissions = useUpdateWorkspacePermissions()
  const rowUserIsOrgAdmin = memberRole === 'owner' || memberRole === 'admin'

  const handleChange = async (workspaceId: string, next: PermissionType) => {
    try {
      await updatePermissions.mutateAsync({
        workspaceId,
        organizationId,
        updates: [{ userId, permissions: next }],
      })
    } catch (error) {
      logger.error('Failed to update workspace permission', { error, workspaceId, userId })
    }
  }

  if (workspaces.length === 0) {
    return (
      <div className='border-[var(--border-1)] border-t bg-[var(--surface-4)] px-3.5 py-3 text-[var(--text-muted)] text-small'>
        Not a member of any workspace in this organization yet.
      </div>
    )
  }

  return (
    <div className='border-[var(--border-1)] border-t bg-[var(--surface-4)]'>
      {workspaces.map((ws, idx) => {
        const callerIsWorkspaceAdmin = currentUserAdminWorkspaceIds.has(ws.workspaceId)
        const wouldDemoteSelf = userId === currentUserId && ws.permission === 'admin'
        const disabled =
          rowUserIsOrgAdmin ||
          !callerIsWorkspaceAdmin ||
          wouldDemoteSelf ||
          updatePermissions.isPending

        const selector = (
          <PermissionSelector
            value={ws.permission}
            onChange={(next) => handleChange(ws.workspaceId, next)}
            disabled={disabled}
            size='compact'
          />
        )

        return (
          <div
            key={ws.workspaceId}
            className={cn(
              'flex items-center justify-between gap-4 px-3.5 py-2.5',
              idx > 0 && 'border-[var(--border-1)] border-t'
            )}
          >
            <span className='truncate font-medium text-[var(--text-primary)] text-small'>
              {ws.workspaceName}
            </span>
            {rowUserIsOrgAdmin ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className='inline-flex'>{selector}</div>
                </Tooltip.Trigger>
                <Tooltip.Content side='top'>User is an organization {memberRole}</Tooltip.Content>
              </Tooltip.Root>
            ) : (
              selector
            )}
          </div>
        )
      })}
    </div>
  )
}

function InvitationExpandedPanel({
  invitationId,
  grants,
  currentUserAdminWorkspaceIds,
  organizationId,
}: {
  invitationId: string
  grants: RosterWorkspaceAccess[]
  currentUserAdminWorkspaceIds: Set<string>
  organizationId: string
}) {
  const updateInvitation = useUpdateInvitation()

  const handleChange = async (workspaceId: string, next: PermissionType) => {
    try {
      await updateInvitation.mutateAsync({
        orgId: organizationId,
        invitationId,
        grants: [{ workspaceId, permission: next }],
      })
    } catch (error) {
      logger.error('Failed to update invitation grant permission', {
        error,
        workspaceId,
        invitationId,
      })
    }
  }

  if (grants.length === 0) {
    return (
      <div className='border-[var(--border-1)] border-t bg-[var(--surface-4)] px-3.5 py-3 text-[var(--text-muted)] text-small'>
        No workspace access will be granted when this invitation is accepted.
      </div>
    )
  }

  return (
    <div className='border-[var(--border-1)] border-t bg-[var(--surface-4)]'>
      {grants.map((g, idx) => {
        const callerIsWorkspaceAdmin = currentUserAdminWorkspaceIds.has(g.workspaceId)
        const disabled = !callerIsWorkspaceAdmin || updateInvitation.isPending
        return (
          <div
            key={g.workspaceId}
            className={cn(
              'flex items-center justify-between gap-4 px-3.5 py-2.5',
              idx > 0 && 'border-[var(--border-1)] border-t'
            )}
          >
            <span className='truncate font-medium text-[var(--text-primary)] text-small'>
              {g.workspaceName}
            </span>
            <PermissionSelector
              value={g.permission}
              onChange={(next) => handleChange(g.workspaceId, next)}
              disabled={disabled}
              size='compact'
            />
          </div>
        )
      })}
    </div>
  )
}

function matchesQuery(haystacks: Array<string | null | undefined>, q: string): boolean {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return haystacks.some((h) => (h ?? '').toLowerCase().includes(needle))
}

export function OrganizationRoster({
  organizationId,
  roster,
  isLoadingRoster,
  currentUserEmail,
  currentUserId,
  isAdminOrOwner,
  onRemoveMember,
  onTransferOwnership,
}: OrganizationRosterProps) {
  const [query, setQuery] = useState('')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set())
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set())
  const [resendingIds, setResendingIds] = useState<Set<string>>(() => new Set())
  const [resendCooldowns, setResendCooldowns] = useState<Record<string, number>>({})
  const cooldownIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  useEffect(() => {
    const intervals = cooldownIntervalsRef.current
    return () => {
      intervals.forEach((interval) => clearInterval(interval))
      intervals.clear()
    }
  }, [])

  const cancelInvitation = useCancelInvitation()
  const resendInvitation = useResendInvitation()

  const { data: memberUsageResponse, isLoading: isLoadingUsage } =
    useOrganizationMembers(organizationId)

  const memberUsageData: Record<string, number> = {}
  if (memberUsageResponse?.data) {
    memberUsageResponse.data.forEach(
      (entry: { userId: string; currentPeriodCost?: number | null }) => {
        if (entry.currentPeriodCost !== null && entry.currentPeriodCost !== undefined) {
          memberUsageData[entry.userId] = Number.parseFloat(entry.currentPeriodCost.toString())
        }
      }
    )
  }

  const rawDollars = Object.values(memberUsageData)
  const totalCredits = dollarsToCredits(rawDollars.reduce((sum, d) => sum + d, 0))
  const memberCredits = apportionCredits(memberUsageData, totalCredits)

  const members: RosterMember[] = roster?.members ?? []
  const pendingInvitations: RosterPendingInvitation[] = roster?.pendingInvitations ?? []

  const currentUserAdminWorkspaceIds = useMemo(() => {
    if (isAdminOrOwner) {
      return new Set((roster?.workspaces ?? []).map((ws) => ws.id))
    }
    const self = members.find((m) => m.userId === currentUserId)
    if (!self) return new Set<string>()
    return new Set(
      self.workspaces.filter((ws) => ws.permission === 'admin').map((ws) => ws.workspaceId)
    )
  }, [isAdminOrOwner, roster?.workspaces, members, currentUserId])

  const canEditRoles = isAdminOrOwner

  const updateMemberRole = useUpdateOrganizationMemberRole()
  const updateInvitation = useUpdateInvitation()

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const workspaceNames = m.workspaces.map((ws) => ws.workspaceName)
      return matchesQuery([m.name, m.email, ...workspaceNames], query)
    })
  }, [members, query])

  const filteredInvitations = useMemo(() => {
    return pendingInvitations.filter((inv) => {
      const workspaceNames = inv.workspaces.map((ws) => ws.workspaceName)
      return matchesQuery([inv.inviteeName, inv.email, ...workspaceNames], query)
    })
  }, [pendingInvitations, query])

  const totalFiltered = filteredMembers.length + filteredInvitations.length
  const totalRows = members.length + pendingInvitations.length
  const currentUser = members.find((m) => m.userId === currentUserId)
  const canLeave = currentUser && currentUser.role !== 'owner'

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCancelInvitation = async (invitationId: string) => {
    setCancellingIds((prev) => new Set([...prev, invitationId]))
    try {
      await cancelInvitation.mutateAsync({ invitationId, orgId: organizationId })
    } catch (error) {
      logger.error('Failed to cancel invitation', { error })
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev)
        next.delete(invitationId)
        return next
      })
    }
  }

  const handleResendInvitation = async (invitationId: string) => {
    const secondsLeft = resendCooldowns[invitationId]
    if (secondsLeft && secondsLeft > 0) return

    setResendingIds((prev) => new Set([...prev, invitationId]))
    try {
      await resendInvitation.mutateAsync({ invitationId, orgId: organizationId })
      setResendCooldowns((prev) => ({ ...prev, [invitationId]: 60 }))
      const existing = cooldownIntervalsRef.current.get(invitationId)
      if (existing) clearInterval(existing)
      const interval = setInterval(() => {
        setResendCooldowns((prev) => {
          const current = prev[invitationId]
          if (current === undefined) return prev
          if (current <= 1) {
            const next = { ...prev }
            delete next[invitationId]
            const tracked = cooldownIntervalsRef.current.get(invitationId)
            if (tracked) {
              clearInterval(tracked)
              cooldownIntervalsRef.current.delete(invitationId)
            }
            return next
          }
          return { ...prev, [invitationId]: current - 1 }
        })
      }, 1000)
      cooldownIntervalsRef.current.set(invitationId, interval)
    } catch (error) {
      logger.error('Failed to resend invitation', { error })
    } finally {
      setResendingIds((prev) => {
        const next = new Set(prev)
        next.delete(invitationId)
        return next
      })
    }
  }

  const showEmpty = !isLoadingRoster && totalRows === 0
  const showNoMatches = !isLoadingRoster && totalRows > 0 && totalFiltered === 0

  return (
    <div className='flex flex-col gap-3'>
      <div className='relative'>
        <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-[var(--text-muted)]' />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search by name, email, or workspace'
          className='pl-9'
        />
      </div>

      {showEmpty ? (
        <div className='rounded-md border border-[var(--border-1)] bg-[var(--surface-5)] px-3.5 py-6 text-center'>
          <p className='font-medium text-[var(--text-primary)] text-base'>No members yet</p>
          <p className='mt-1 text-[var(--text-muted)] text-small'>
            Invite someone above to get started.
          </p>
        </div>
      ) : (
        <div className='overflow-hidden rounded-md border border-[var(--border-1)]'>
          <Table>
            <TableHeader>
              <TableRow className='bg-[var(--surface-5)]'>
                <TableHead className='w-[36px]' />
                <TableHead className='w-[50%]'>Member</TableHead>
                <TableHead className='w-[14%]'>Role</TableHead>
                <TableHead className='w-[36%] text-right'>
                  {isAdminOrOwner ? 'Usage' : ''}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingRoster && totalRows === 0
                ? Array.from({ length: 3 }).map((_, i) => (
                    <RosterRowSkeleton key={`skeleton-${i}`} />
                  ))
                : null}

              {showNoMatches && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className='py-6 text-center text-[var(--text-muted)] text-small'
                  >
                    No matches for “{query}”
                  </TableCell>
                </TableRow>
              )}

              {filteredMembers.map((m) => {
                const rowKey = `member-${m.memberId}`
                const expanded = expandedRows.has(rowKey)
                const isSelf = m.email === currentUserEmail
                const credits = memberCredits[m.userId] ?? 0
                const canRemove = isAdminOrOwner && m.role !== 'owner' && !isSelf
                const canTransferAndLeave = isSelf && m.role === 'owner' && !!onTransferOwnership
                return (
                  <Fragment key={rowKey}>
                    <TableRow>
                      <TableCell className='w-[36px] align-middle'>
                        <ChevronCell expanded={expanded} onClick={() => toggleRow(rowKey)} />
                      </TableCell>
                      <TableCell>
                        <button
                          type='button'
                          onClick={() => toggleRow(rowKey)}
                          className='w-full text-left'
                        >
                          <MemberIdentity
                            name={m.name}
                            email={m.email}
                            image={m.image}
                            userId={m.userId}
                          />
                        </button>
                      </TableCell>
                      <TableCell>
                        {m.role === 'owner' || !canEditRoles || m.userId === currentUserId ? (
                          <RoleBadge role={m.role} />
                        ) : (
                          <OrgRoleSelector
                            value={(m.role === 'admin' ? 'admin' : 'member') as OrgRole}
                            onChange={(next) =>
                              updateMemberRole
                                .mutateAsync({
                                  orgId: organizationId,
                                  userId: m.userId,
                                  role: next,
                                })
                                .catch((error) =>
                                  logger.error('Failed to update member role', { error })
                                )
                            }
                            disabled={updateMemberRole.isPending}
                          />
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          {isAdminOrOwner ? (
                            isLoadingUsage ? (
                              <Skeleton className='h-4 w-16' />
                            ) : (
                              <span className='font-medium text-[var(--text-primary)] text-small tabular-nums'>
                                {credits.toLocaleString()} credits
                              </span>
                            )
                          ) : null}
                          {canRemove && (
                            <Button
                              variant='ghost'
                              onClick={() => {
                                const legacyMember: Member = {
                                  id: m.memberId,
                                  role: m.role,
                                  user: {
                                    id: m.userId,
                                    name: m.name,
                                    email: m.email,
                                    image: m.image,
                                  },
                                }
                                onRemoveMember(legacyMember)
                              }}
                              className='h-8'
                            >
                              Remove
                            </Button>
                          )}
                          {canTransferAndLeave && (
                            <Button
                              variant='ghost'
                              onClick={() => onTransferOwnership?.()}
                              className='h-8'
                            >
                              Leave
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={4} className='p-0'>
                          <MemberExpandedPanel
                            userId={m.userId}
                            memberRole={m.role}
                            workspaces={m.workspaces}
                            currentUserId={currentUserId}
                            currentUserAdminWorkspaceIds={currentUserAdminWorkspaceIds}
                            organizationId={organizationId}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}

              {filteredInvitations.map((inv) => {
                const rowKey = `invite-${inv.id}`
                const expanded = expandedRows.has(rowKey)
                const isResending = resendingIds.has(inv.id)
                const isCancelling = cancellingIds.has(inv.id)
                const cooldown = resendCooldowns[inv.id] ?? 0
                const resendDisabled = isResending || cooldown > 0
                return (
                  <Fragment key={rowKey}>
                    <TableRow>
                      <TableCell className='w-[36px] align-middle'>
                        <ChevronCell expanded={expanded} onClick={() => toggleRow(rowKey)} />
                      </TableCell>
                      <TableCell>
                        <button
                          type='button'
                          onClick={() => toggleRow(rowKey)}
                          className='w-full text-left'
                        >
                          <MemberIdentity
                            name={inv.inviteeName || inv.email.split('@')[0]}
                            email={inv.email}
                            image={inv.inviteeImage}
                            userId={inv.email}
                            trailing={
                              <Badge variant='gray-secondary' size='sm'>
                                Pending
                              </Badge>
                            }
                          />
                        </button>
                      </TableCell>
                      <TableCell>
                        {isAdminOrOwner ? (
                          <OrgRoleSelector
                            value={(inv.role === 'admin' ? 'admin' : 'member') as OrgRole}
                            onChange={(next) =>
                              updateInvitation
                                .mutateAsync({
                                  orgId: organizationId,
                                  invitationId: inv.id,
                                  role: next,
                                })
                                .catch((error) =>
                                  logger.error('Failed to update invitation role', { error })
                                )
                            }
                            disabled={updateInvitation.isPending}
                          />
                        ) : (
                          <RoleBadge role={inv.role} />
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        {isAdminOrOwner && (
                          <div className='flex items-center justify-end gap-1'>
                            <Button
                              variant='ghost'
                              onClick={() => handleResendInvitation(inv.id)}
                              disabled={resendDisabled}
                              className='h-8'
                            >
                              {isResending
                                ? 'Sending…'
                                : cooldown > 0
                                  ? `Resend (${cooldown}s)`
                                  : 'Resend'}
                            </Button>
                            <Button
                              variant='ghost'
                              onClick={() => handleCancelInvitation(inv.id)}
                              disabled={isCancelling}
                              className='h-8'
                            >
                              {isCancelling ? 'Cancelling…' : 'Cancel'}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={4} className='p-0'>
                          <InvitationExpandedPanel
                            invitationId={inv.id}
                            grants={inv.workspaces}
                            currentUserAdminWorkspaceIds={currentUserAdminWorkspaceIds}
                            organizationId={organizationId}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canLeave && currentUser && (
        <div className='flex justify-end'>
          <Button
            variant='ghost'
            onClick={() =>
              onRemoveMember({
                id: currentUser.memberId,
                role: currentUser.role,
                user: {
                  id: currentUser.userId,
                  name: currentUser.name,
                  email: currentUser.email,
                  image: currentUser.image,
                },
              })
            }
          >
            Leave Organization
          </Button>
        </div>
      )}
    </div>
  )
}
