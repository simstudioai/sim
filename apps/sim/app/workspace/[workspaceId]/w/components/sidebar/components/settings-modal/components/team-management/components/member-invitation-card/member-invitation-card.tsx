'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import type { AdminWorkspace } from '@/hooks/queries/workspace'

type PermissionType = 'read' | 'write' | 'admin'

interface PermissionSelectorProps {
  value: PermissionType
  onChange: (value: PermissionType) => void
  disabled?: boolean
  className?: string
}

const PermissionSelector = React.memo<PermissionSelectorProps>(
  ({ value, onChange, disabled = false, className = '' }) => {
    const t = useTranslations()
    return (
      <ButtonGroup
        value={value}
        onValueChange={(val) => onChange(val as PermissionType)}
        disabled={disabled}
        className={className}
      >
        <ButtonGroupItem
          value='read'
          className='h-[22px] min-w-[38px] px-[6px] py-0 text-[11px]'
          title={t('settings.member_invitation.titles.view_only')}
        >
          {t('settings.member_invitation.permissions.read')}
        </ButtonGroupItem>
        <ButtonGroupItem
          value='write'
          className='h-[22px] min-w-[38px] px-[6px] py-0 text-[11px]'
          title={t('settings.member_invitation.titles.edit_content')}
        >
          {t('settings.member_invitation.permissions.write')}
        </ButtonGroupItem>
        <ButtonGroupItem
          value='admin'
          className='h-[22px] min-w-[38px] px-[6px] py-0 text-[11px]'
          title={t('settings.member_invitation.titles.full_access')}
        >
          {t('settings.member_invitation.permissions.admin')}
        </ButtonGroupItem>
      </ButtonGroup>
    )
  }
)

PermissionSelector.displayName = 'PermissionSelector'

interface MemberInvitationCardProps {
  inviteEmails: TagItem[]
  setInviteEmails: (emails: TagItem[]) => void
  isInviting: boolean
  showWorkspaceInvite: boolean
  setShowWorkspaceInvite: (show: boolean) => void
  selectedWorkspaces: Array<{ workspaceId: string; permission: string }>
  userWorkspaces: AdminWorkspace[]
  onInviteMember: () => Promise<void>
  onLoadUserWorkspaces: () => Promise<void>
  onWorkspaceToggle: (workspaceId: string, permission: string) => void
  inviteSuccess: boolean
  availableSeats?: number
  maxSeats?: number
  invitationError?: Error | null
  isLoadingWorkspaces?: boolean
}

export function MemberInvitationCard({
  inviteEmails,
  setInviteEmails,
  isInviting,
  showWorkspaceInvite,
  setShowWorkspaceInvite,
  selectedWorkspaces,
  userWorkspaces,
  onInviteMember,
  onLoadUserWorkspaces,
  onWorkspaceToggle,
  inviteSuccess,
  availableSeats = 0,
  maxSeats = 0,
  invitationError = null,
  isLoadingWorkspaces = false,
}: MemberInvitationCardProps) {
  const t = useTranslations()
  const selectedCount = selectedWorkspaces.length
  const hasAvailableSeats = availableSeats > 0
  const hasValidEmails = inviteEmails.some((e) => e.isValid)

  const handleAddEmail = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false

    const isDuplicate = inviteEmails.some((e) => e.value === normalized)
    if (isDuplicate) return false

    const validation = quickValidateEmail(normalized)
    setInviteEmails([...inviteEmails, { value: normalized, isValid: validation.isValid }])
    return validation.isValid
  }

  const handleRemoveEmail = (_value: string, index: number) => {
    setInviteEmails(inviteEmails.filter((_, i) => i !== index))
  }

  return (
    <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
      <div className='px-[14px] py-[10px]'>
        <h4 className='font-medium text-[14px] text-[var(--text-primary)]'>
          {t('settings.member_invitation.title')}
        </h4>
        <p className='text-[12px] text-[var(--text-muted)]'>
          {t('settings.member_invitation.description')}
        </p>
      </div>

      <div className='flex flex-col gap-[12px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[12px]'>
        <div className='flex items-start gap-[8px]'>
          <div className='flex-1'>
            <TagInput
              items={inviteEmails}
              onAdd={handleAddEmail}
              onRemove={handleRemoveEmail}
              placeholder={t('settings.member_invitation.placeholders.email')}
              placeholderWithTags={t('settings.member_invitation.placeholders.another_email')}
              disabled={isInviting || !hasAvailableSeats}
              triggerKeys={['Enter', ',', ' ']}
              maxHeight='max-h-24'
            />
          </div>
          <Popover
            open={showWorkspaceInvite}
            onOpenChange={(open) => {
              setShowWorkspaceInvite(open)
              if (open) {
                onLoadUserWorkspaces()
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant='active'
                disabled={isInviting || !hasAvailableSeats}
                className='min-w-[110px]'
              >
                <span className='flex-1 text-left'>
                  {t('settings.member_invitation.labels.workspaces')}
                  {selectedCount > 0 && ` (${selectedCount})`}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform',
                    showWorkspaceInvite && 'rotate-180'
                  )}
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side='bottom'
              align='end'
              maxHeight={320}
              sideOffset={4}
              minWidth={240}
              maxWidth={240}
              border
            >
              {isLoadingWorkspaces ? (
                <div className='px-[6px] py-[16px] text-center'>
                  <p className='text-[12px] text-[var(--text-tertiary)]'>
                    {t('settings.member_invitation.loading')}
                  </p>
                </div>
              ) : userWorkspaces.length === 0 ? (
                <div className='px-[6px] py-[16px] text-center'>
                  <p className='text-[12px] text-[var(--text-tertiary)]'>
                    {t('settings.member_invitation.no_workspaces')}
                  </p>
                </div>
              ) : (
                <div className='flex flex-col gap-[2px]'>
                  {userWorkspaces.map((workspace) => {
                    const isSelected = selectedWorkspaces.some(
                      (w) => w.workspaceId === workspace.id
                    )
                    const selectedWorkspace = selectedWorkspaces.find(
                      (w) => w.workspaceId === workspace.id
                    )

                    return (
                      <div key={workspace.id} className='flex flex-col gap-[4px]'>
                        <PopoverItem
                          onClick={() => {
                            if (isSelected) {
                              onWorkspaceToggle(workspace.id, '')
                            } else {
                              onWorkspaceToggle(workspace.id, 'read')
                            }
                          }}
                          active={isSelected}
                          disabled={isInviting}
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={isInviting}
                            className='pointer-events-none'
                          />
                          <span className='flex-1 truncate'>{workspace.name}</span>
                        </PopoverItem>
                        {isSelected && (
                          <div className='ml-[31px] flex items-center gap-[6px] pb-[4px]'>
                            <span className='text-[11px] text-[var(--text-tertiary)]'>
                              {t('settings.member_invitation.labels.access')}
                            </span>
                            <PermissionSelector
                              value={
                                (['read', 'write', 'admin'].includes(
                                  selectedWorkspace?.permission ?? ''
                                )
                                  ? selectedWorkspace?.permission
                                  : 'read') as PermissionType
                              }
                              onChange={(permission) => onWorkspaceToggle(workspace.id, permission)}
                              disabled={isInviting}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant='tertiary'
            onClick={() => onInviteMember()}
            disabled={!hasValidEmails || isInviting || !hasAvailableSeats}
          >
            {isInviting
              ? t('settings.member_invitation.buttons.inviting')
              : hasAvailableSeats
                ? t('settings.member_invitation.buttons.invite')
                : t('settings.member_invitation.buttons.no_seats')}
          </Button>
        </div>

        {invitationError && (
          <p className='text-[12px] text-[var(--text-error)] leading-tight'>
            {invitationError instanceof Error && invitationError.message
              ? invitationError.message
              : String(invitationError)}
          </p>
        )}

        {inviteSuccess && (
          <p className='text-[11px] text-[var(--text-success)] leading-tight'>
            {selectedCount > 0
              ? t('settings.member_invitation.success_with_workspaces', { count: selectedCount })
              : t('settings.member_invitation.success')}
          </p>
        )}
      </div>
    </div>
  )
}
