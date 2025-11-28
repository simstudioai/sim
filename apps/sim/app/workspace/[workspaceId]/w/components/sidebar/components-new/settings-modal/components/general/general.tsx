'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Pencil } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button, Combobox, Label, Switch } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal-new/modal'
import { Input, Skeleton } from '@/components/ui'
import { signOut, useSession } from '@/lib/auth-client'
import { useBrandConfig } from '@/lib/branding/branding'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/hooks/use-profile-picture-upload'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useUpdateUserProfile, useUserProfile } from '@/hooks/queries/user-profile'
import { clearUserData } from '@/stores'

const logger = createLogger('General')

/**
 * Extracts initials from a user's name.
 * @param name - The user's full name
 * @returns Up to 2 characters: first letters of first and last name, or just the first letter
 */
function getInitials(name: string | undefined | null): string {
  if (!name?.trim()) return ''
  const parts = name.trim().split(' ')
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  }
  return parts[0][0].toUpperCase()
}

interface GeneralProps {
  onOpenChange?: (open: boolean) => void
}

export function General({ onOpenChange }: GeneralProps) {
  const router = useRouter()
  const brandConfig = useBrandConfig()
  const { data: session } = useSession()

  const { data: profile, isLoading: isProfileLoading } = useUserProfile()
  const updateProfile = useUpdateUserProfile()

  const { data: settings, isLoading: isSettingsLoading } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()

  const isLoading = isProfileLoading || isSettingsLoading

  const isTrainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))

  const [isSuperUser, setIsSuperUser] = useState(false)
  const [loadingSuperUser, setLoadingSuperUser] = useState(true)

  const [name, setName] = useState(profile?.name || '')
  const [isEditingName, setIsEditingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false)
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState(false)
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null)

  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    if (profile?.name) {
      setName(profile.name)
    }
  }, [profile?.name])

  useEffect(() => {
    const fetchSuperUserStatus = async () => {
      try {
        const response = await fetch('/api/user/super-user')
        if (response.ok) {
          const data = await response.json()
          setIsSuperUser(data.isSuperUser)
        }
      } catch (error) {
        logger.error('Failed to fetch super user status:', error)
      } finally {
        setLoadingSuperUser(false)
      }
    }

    if (session?.user?.id) {
      fetchSuperUserStatus()
    }
  }, [session?.user?.id])

  const {
    previewUrl: profilePictureUrl,
    fileInputRef: profilePictureInputRef,
    handleThumbnailClick: handleProfilePictureClick,
    handleFileChange: handleProfilePictureChange,
    isUploading: isUploadingProfilePicture,
  } = useProfilePictureUpload({
    currentImage: profile?.image || null,
    onUpload: (url: string | null) => {
      updateProfile
        .mutateAsync({ image: url })
        .then(() => {
          setUploadError(null)
        })
        .catch(() => {
          setUploadError(
            url ? 'Failed to update profile picture' : 'Failed to remove profile picture'
          )
        })
    },
    onError: (error: string) => {
      setUploadError(error)
      setTimeout(() => setUploadError(null), 5000)
    },
  })

  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingName])

  const handleUpdateName = async () => {
    const trimmedName = name.trim()

    if (!trimmedName) {
      return
    }

    if (trimmedName === profile?.name) {
      setIsEditingName(false)
      return
    }

    try {
      await updateProfile.mutateAsync({ name: trimmedName })
      setIsEditingName(false)
    } catch (error) {
      logger.error('Error updating name:', error)
      setName(profile?.name || '')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleUpdateName()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleCancelEdit = () => {
    setIsEditingName(false)
    setName(profile?.name || '')
  }

  const handleInputBlur = () => {
    handleUpdateName()
  }

  const handleSignOut = async () => {
    try {
      await Promise.all([signOut(), clearUserData()])
      router.push('/login?fromLogout=true')
    } catch (error) {
      logger.error('Error signing out:', { error })
      router.push('/login?fromLogout=true')
    }
  }

  const handleResetPasswordConfirm = async () => {
    if (!profile?.email) return

    setIsResettingPassword(true)
    setResetPasswordError(null)

    try {
      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: profile.email,
          redirectTo: `${getBaseUrl()}/reset-password`,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to send reset password email')
      }

      setResetPasswordSuccess(true)

      setTimeout(() => {
        setShowResetPasswordModal(false)
        setResetPasswordSuccess(false)
      }, 1500)
    } catch (error) {
      logger.error('Error resetting password:', error)
      setResetPasswordError('Failed to send email')

      setTimeout(() => {
        setResetPasswordError(null)
      }, 5000)
    } finally {
      setIsResettingPassword(false)
    }
  }

  const handleThemeChange = async (value: string) => {
    await updateSetting.mutateAsync({ key: 'theme', value: value as 'system' | 'light' | 'dark' })
  }

  const handleAutoConnectChange = async (checked: boolean) => {
    if (checked !== settings?.autoConnect && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'autoConnect', value: checked })
    }
  }

  const handleTrainingControlsChange = async (checked: boolean) => {
    if (checked !== settings?.showTrainingControls && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'showTrainingControls', value: checked })
    }
  }

  const handleErrorNotificationsChange = async (checked: boolean) => {
    if (checked !== settings?.errorNotificationsEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'errorNotificationsEnabled', value: checked })
    }
  }

  const handleSuperUserModeToggle = async (checked: boolean) => {
    if (checked !== settings?.superUserModeEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'superUserModeEnabled', value: checked })
    }
  }

  const handleTelemetryToggle = async (checked: boolean) => {
    if (checked !== settings?.telemetryEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'telemetryEnabled', value: checked })

      if (checked) {
        if (typeof window !== 'undefined') {
          fetch('/api/telemetry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category: 'consent',
              action: 'enable_from_settings',
              timestamp: new Date().toISOString(),
            }),
          }).catch(() => {})
        }
      }
    }
  }

  const imageUrl = profilePictureUrl || profile?.image || brandConfig.logoUrl

  if (isLoading) {
    return <GeneralSkeleton />
  }

  return (
    <div className='flex h-full flex-col gap-[16px]'>
      {/* User Info Section */}
      <div className='flex items-center gap-[12px]'>
        <div className='relative'>
          <div
            className={`group relative flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full transition-all hover:bg-[var(--bg)] ${!imageUrl ? 'border border-[var(--border)]' : ''}`}
            onClick={handleProfilePictureClick}
          >
            {(() => {
              if (imageUrl) {
                return (
                  <Image
                    src={imageUrl}
                    alt={profile?.name || 'User'}
                    width={36}
                    height={36}
                    className={`h-full w-full object-cover transition-opacity duration-300 ${
                      isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                    }`}
                  />
                )
              }
              return (
                <span className='font-medium text-[14px] text-[var(--text-primary)]'>
                  {getInitials(profile?.name) || ''}
                </span>
              )
            })()}
            <div
              className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/50 transition-opacity ${
                isUploadingProfilePicture ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {isUploadingProfilePicture ? (
                <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
              ) : (
                <Camera className='h-4 w-4 text-white' />
              )}
            </div>
          </div>
          <Input
            type='file'
            accept='image/png,image/jpeg,image/jpg'
            className='hidden'
            ref={profilePictureInputRef}
            onChange={handleProfilePictureChange}
            disabled={isUploadingProfilePicture}
          />
        </div>
        <div className='flex flex-1 flex-col justify-center gap-[1px]'>
          <div className='flex items-center gap-[8px]'>
            {isEditingName ? (
              <>
                <input
                  ref={inputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleInputBlur}
                  className='w-auto border-0 bg-transparent p-0 font-medium text-[14px] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                  size={Math.max(name.length, 1)}
                  maxLength={100}
                  disabled={updateProfile.isPending}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  spellCheck='false'
                />
                <Button
                  variant='ghost'
                  className='h-[11px] w-[11px] flex-shrink-0 p-0'
                  onClick={handleUpdateName}
                  disabled={updateProfile.isPending}
                  aria-label='Save name'
                >
                  <Check className='h-[11px] w-[11px]' />
                </Button>
              </>
            ) : (
              <>
                <h3 className='font-medium text-[14px]'>{profile?.name || ''}</h3>
                <Button
                  variant='ghost'
                  className='h-[11px] w-[11px] flex-shrink-0 p-0'
                  onClick={() => setIsEditingName(true)}
                  aria-label='Edit name'
                >
                  <Pencil className='h-[11px] w-[11px]' />
                </Button>
              </>
            )}
          </div>
          <p className='text-[13px] text-[var(--text-muted)]'>{profile?.email || ''}</p>
        </div>
      </div>
      {uploadError && <p className='text-[13px] text-[var(--text-error)]'>{uploadError}</p>}

      <div className='flex items-center justify-between border-b pb-[12px]'>
        <Label htmlFor='theme-select'>Theme</Label>
        <div className='w-[100px]'>
          <Combobox
            size='sm'
            align='end'
            dropdownWidth={140}
            value={settings?.theme}
            onChange={handleThemeChange}
            disabled={updateSetting.isPending}
            placeholder='Select theme'
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ]}
          />
        </div>
      </div>

      <div className='flex items-center justify-between'>
        <Label htmlFor='auto-connect'>Auto-connect on drop</Label>
        <Switch
          id='auto-connect'
          checked={settings?.autoConnect ?? true}
          onCheckedChange={handleAutoConnectChange}
          disabled={updateSetting.isPending}
        />
      </div>

      <div className='flex items-center justify-between'>
        <Label htmlFor='error-notifications'>Run error notifications</Label>
        <Switch
          id='error-notifications'
          checked={settings?.errorNotificationsEnabled ?? true}
          onCheckedChange={handleErrorNotificationsChange}
          disabled={updateSetting.isPending}
        />
      </div>

      <div className='flex items-center justify-between border-t pt-[12px]'>
        <Label htmlFor='telemetry'>Allow anonymous telemetry</Label>
        <Switch
          id='telemetry'
          checked={settings?.telemetryEnabled ?? true}
          onCheckedChange={handleTelemetryToggle}
          disabled={updateSetting.isPending}
        />
      </div>

      <p className='text-[12px] text-[var(--text-muted)]'>
        We use OpenTelemetry to collect anonymous usage data to improve Sim. All data is collected
        in accordance with our privacy policy, and you can opt-out at any time.
      </p>

      {isTrainingEnabled && (
        <div className='flex items-center justify-between'>
          <Label htmlFor='training-controls'>Training controls</Label>
          <Switch
            id='training-controls'
            checked={settings?.showTrainingControls ?? false}
            onCheckedChange={handleTrainingControlsChange}
            disabled={updateSetting.isPending}
          />
        </div>
      )}

      {!loadingSuperUser && isSuperUser && (
        <div className='flex items-center justify-between'>
          <Label htmlFor='super-user-mode'>Super admin mode</Label>
          <Switch
            id='super-user-mode'
            checked={settings?.superUserModeEnabled ?? true}
            onCheckedChange={handleSuperUserModeToggle}
            disabled={updateSetting.isPending}
          />
        </div>
      )}

      <div className='mt-auto flex items-center gap-[8px]'>
        <Button onClick={handleSignOut}>Sign out</Button>
        <Button onClick={() => setShowResetPasswordModal(true)}>Reset password</Button>
      </div>

      {/* Password Reset Confirmation Modal */}
      <Modal open={showResetPasswordModal} onOpenChange={setShowResetPasswordModal}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Reset Password</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              A password reset link will be sent to{' '}
              <span className='font-medium text-[var(--text-primary)]'>{profile?.email}</span>.
              Click the link in the email to create a new password.
            </p>
            {resetPasswordError && (
              <p className='mt-[8px] text-[12px] text-[var(--text-error)]'>{resetPasswordError}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={() => setShowResetPasswordModal(false)}
              disabled={isResettingPassword || resetPasswordSuccess}
            >
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleResetPasswordConfirm}
              disabled={isResettingPassword || resetPasswordSuccess}
            >
              {isResettingPassword
                ? 'Sending...'
                : resetPasswordSuccess
                  ? 'Sent'
                  : 'Send Reset Email'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

/**
 * Skeleton component for general settings loading state.
 * Matches the exact layout structure of the General component.
 */
function GeneralSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      {/* User Info Section */}
      <div className='flex items-center gap-[12px]'>
        <Skeleton className='h-9 w-9 rounded-full' />
        <div className='flex flex-1 flex-col justify-center gap-[1px]'>
          <div className='flex items-center gap-[8px]'>
            <Skeleton className='h-[14px] w-24' />
            <Skeleton className='h-[11px] w-[11px]' />
          </div>
          <Skeleton className='h-[13px] w-40' />
        </div>
      </div>

      {/* Theme row */}
      <div className='flex items-center justify-between border-b pb-[12px]'>
        <Skeleton className='h-4 w-12' />
        <Skeleton className='h-8 w-[100px] rounded-[8px]' />
      </div>

      {/* Auto-connect row */}
      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-36' />
        <Skeleton className='h-[17px] w-[30px] rounded-[20px]' />
      </div>

      {/* Error notifications row */}
      <div className='flex items-center justify-between'>
        <Skeleton className='h-4 w-36' />
        <Skeleton className='h-[17px] w-[30px] rounded-[20px]' />
      </div>

      {/* Telemetry row */}
      <div className='flex items-center justify-between border-t pt-[12px]'>
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-[17px] w-[30px] rounded-[20px]' />
      </div>

      {/* Telemetry description */}
      <div className='space-y-1'>
        <Skeleton className='h-3 w-full' />
        <Skeleton className='h-3 w-4/5' />
      </div>

      {/* Action buttons */}
      <div className='mt-auto flex items-center gap-[8px]'>
        <Skeleton className='h-8 w-20 rounded-[4px]' />
        <Skeleton className='h-8 w-28 rounded-[4px]' />
      </div>
    </div>
  )
}
