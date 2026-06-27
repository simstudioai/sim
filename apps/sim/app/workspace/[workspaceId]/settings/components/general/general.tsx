'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Camera, Check, Info, Pencil } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import {
  Button,
  Chip,
  ChipCombobox,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  Input,
  Label,
  Switch,
  Tooltip,
} from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { telemetryContract } from '@/lib/api/contracts/telemetry'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'
import { getBrowserTimezone, getTimezoneOptions } from '@/lib/core/utils/timezone'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/settings/hooks/use-profile-picture-upload'
import { useBrandConfig } from '@/ee/whitelabeling'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import {
  useResetPassword,
  useUpdateUserProfile,
  useUserProfile,
} from '@/hooks/queries/user-profile'
import { clearUserData } from '@/stores'

const logger = createLogger('General')

/** Human-friendly timezone options for the picker, common zones first. */
const TIMEZONE_OPTIONS = getTimezoneOptions()

/**
 * Shared trigger width for the three appearance dropdowns (Theme, Timezone, Snap
 * to grid) so they line up as one column instead of three differently-sized
 * pills. Wide enough for the longest common timezone label.
 */
const DROPDOWN_TRIGGER_CLASS = 'w-[240px] flex-shrink-0'

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

export function General() {
  const router = useRouter()
  const brandConfig = useBrandConfig()
  const { data: session } = useSession()

  const { data: profile, isLoading: isProfileLoading } = useUserProfile()
  const updateProfile = useUpdateUserProfile()

  const { data: settings, isLoading: isSettingsLoading } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()

  const isLoading = isProfileLoading || isSettingsLoading

  const isTrainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))
  const isAuthDisabled = session?.user?.id === ANONYMOUS_USER_ID

  const [name, setName] = useState(profile?.name || '')
  const [isEditingName, setIsEditingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevProfileNameRef = useRef<string | undefined>(profile?.name)

  if (profile?.name && profile.name !== prevProfileNameRef.current) {
    prevProfileNameRef.current = profile.name
    setName(profile.name)
  }

  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false)
  const resetPassword = useResetPassword()

  const [uploadError, setUploadError] = useState<string | null>(null)

  const snapToGridValue = settings?.snapToGridSize ?? 0

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

    resetPassword.mutate(
      {
        email: profile.email,
        redirectTo: `${getBaseUrl()}/reset-password`,
      },
      {
        onSuccess: () => {
          setTimeout(() => {
            setShowResetPasswordModal(false)
            resetPassword.reset()
          }, 1500)
        },
        onError: (error) => {
          logger.error('Error resetting password:', error)
          setTimeout(() => resetPassword.reset(), 5000)
        },
      }
    )
  }

  const handleThemeChange = async (value: string) => {
    await updateSetting.mutateAsync({ key: 'theme', value: value as 'system' | 'light' | 'dark' })
  }

  const handleTimezoneChange = async (value: string) => {
    await updateSetting.mutateAsync({ key: 'timezone', value })
  }

  const handleAutoConnectChange = async (checked: boolean) => {
    if (checked !== settings?.autoConnect && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'autoConnect', value: checked })
    }
  }

  const handleSnapToGridChange = async (value: string) => {
    const newValue = Number.parseInt(value, 10)
    if (newValue !== settings?.snapToGridSize && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'snapToGridSize', value: newValue })
    }
  }

  const handleShowActionBarChange = async (checked: boolean) => {
    if (checked !== settings?.showActionBar && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'showActionBar', value: checked })
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

  const handleTelemetryToggle = async (checked: boolean) => {
    if (checked !== settings?.telemetryEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'telemetryEnabled', value: checked })

      if (checked) {
        if (typeof window !== 'undefined') {
          requestJson(telemetryContract, {
            body: {
              category: 'consent',
              action: 'enable_from_settings',
              timestamp: new Date().toISOString(),
            },
          }).catch(() => {})
        }
      }
    }
  }

  const imageUrl = profilePictureUrl || profile?.image || brandConfig.logoUrl

  if (isLoading) {
    return null
  }

  return (
    <>
      <SettingsPanel
        actions={
          <>
            {isHosted && (
              <Chip onClick={() => window.open('/?home', '_blank', 'noopener,noreferrer')}>
                Home Page
              </Chip>
            )}
            {!isAuthDisabled && (
              <>
                <Chip onClick={handleSignOut}>Sign out</Chip>
                <Chip onClick={() => setShowResetPasswordModal(true)}>Reset password</Chip>
              </>
            )}
          </>
        }
      >
        <SettingsSection label='Profile'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <div className='relative'>
                <div
                  role='button'
                  tabIndex={0}
                  className={`group relative flex size-9 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full transition-all hover-hover:bg-[var(--bg)] ${!imageUrl ? 'border border-[var(--border)]' : ''}`}
                  onClick={handleProfilePictureClick}
                  onKeyDown={(event) => handleKeyboardActivation(event, handleProfilePictureClick)}
                >
                  {(() => {
                    if (imageUrl) {
                      return (
                        <Image
                          src={imageUrl}
                          alt={profile?.name || 'User'}
                          width={36}
                          height={36}
                          unoptimized
                          className={`h-full w-full object-cover transition-opacity duration-300 ${
                            isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                          }`}
                        />
                      )
                    }
                    return (
                      <span className='font-medium text-[var(--text-primary)] text-base'>
                        {getInitials(profile?.name) || ''}
                      </span>
                    )
                  })()}
                  <div
                    className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/50 transition-opacity ${
                      isUploadingProfilePicture
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isUploadingProfilePicture ? (
                      <div className='size-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
                    ) : (
                      <Camera className='size-4 text-white' />
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
                <div className='flex items-center gap-2'>
                  {isEditingName ? (
                    <>
                      <div className='relative inline-flex'>
                        <span
                          className='invisible whitespace-pre font-medium text-base'
                          aria-hidden='true'
                        >
                          {name || ' '}
                        </span>
                        <input
                          ref={inputRef}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={handleInputBlur}
                          className='absolute top-0 left-0 h-full w-full border-0 bg-transparent p-0 font-medium text-base outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                          maxLength={100}
                          disabled={updateProfile.isPending}
                          autoComplete='off'
                          autoCorrect='off'
                          autoCapitalize='off'
                          spellCheck='false'
                        />
                      </div>
                      <Button
                        variant='ghost'
                        className='size-[12px] flex-shrink-0 p-0'
                        onClick={handleUpdateName}
                        disabled={updateProfile.isPending}
                        aria-label='Save name'
                      >
                        <Check className='size-[12px]' />
                      </Button>
                    </>
                  ) : (
                    <>
                      <h3 className='font-medium text-base'>{profile?.name || ''}</h3>
                      <Button
                        variant='ghost'
                        className='size-[10.5px] flex-shrink-0 p-0'
                        onClick={() => setIsEditingName(true)}
                        aria-label='Edit name'
                      >
                        <Pencil className='size-[10.5px]' />
                      </Button>
                    </>
                  )}
                </div>
                <p className='text-[var(--text-tertiary)] text-sm'>{profile?.email || ''}</p>
              </div>
            </div>
            {uploadError && <p className='text-[var(--text-error)] text-sm'>{uploadError}</p>}
          </div>
        </SettingsSection>

        <SettingsSection label='Preferences'>
          <div className='flex flex-col gap-4'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='theme-select'>Theme</Label>
              <div className={DROPDOWN_TRIGGER_CLASS}>
                <ChipSelect
                  align='start'
                  fullWidth
                  dropdownWidth='trigger'
                  value={settings?.theme}
                  onChange={handleThemeChange}
                  placeholder='Select theme'
                  options={[
                    { label: 'System', value: 'system' },
                    { label: 'Light', value: 'light' },
                    { label: 'Dark', value: 'dark' },
                  ]}
                />
              </div>
            </div>

            <div className='flex items-center justify-between gap-4'>
              <Label>Timezone</Label>
              <div className={DROPDOWN_TRIGGER_CLASS}>
                <ChipCombobox
                  align='start'
                  dropdownWidth={240}
                  searchable
                  searchPlaceholder='Search timezones'
                  value={settings?.timezone ?? getBrowserTimezone()}
                  onChange={handleTimezoneChange}
                  placeholder='Select timezone'
                  options={TIMEZONE_OPTIONS}
                />
              </div>
            </div>

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-1.5'>
                <Label htmlFor='auto-connect'>Auto-connect on drop</Label>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Info className='size-[14px] cursor-default text-[var(--text-muted)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom' align='start'>
                    <p>Automatically connect blocks when dropped near each other</p>
                    <Tooltip.Preview
                      src='/tooltips/auto-connect-on-drop.mp4'
                      alt='Auto-connect on drop example'
                      loop={true}
                    />
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
              <Switch
                id='auto-connect'
                checked={settings?.autoConnect ?? true}
                onCheckedChange={handleAutoConnectChange}
              />
            </div>

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-1.5'>
                <Label htmlFor='error-notifications'>Canvas error notifications</Label>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Info className='size-[14px] cursor-default text-[var(--text-muted)]' />
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom' align='start'>
                    <p>Show error popups on blocks when a workflow run fails</p>
                    <Tooltip.Preview
                      src='/tooltips/canvas-error-notification.mp4'
                      alt='Canvas error notification example'
                    />
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
              <Switch
                id='error-notifications'
                checked={settings?.errorNotificationsEnabled ?? true}
                onCheckedChange={handleErrorNotificationsChange}
              />
            </div>

            <div className='flex items-center justify-between'>
              <Label htmlFor='snap-to-grid'>Snap to grid</Label>
              <div className={DROPDOWN_TRIGGER_CLASS}>
                <ChipSelect
                  align='start'
                  fullWidth
                  dropdownWidth='trigger'
                  value={String(snapToGridValue)}
                  onChange={handleSnapToGridChange}
                  placeholder='Select size'
                  options={[
                    { label: 'Off', value: '0' },
                    { label: '10px', value: '10' },
                    { label: '20px', value: '20' },
                    { label: '30px', value: '30' },
                    { label: '40px', value: '40' },
                    { label: '50px', value: '50' },
                  ]}
                />
              </div>
            </div>

            <div className='flex items-center justify-between'>
              <Label htmlFor='show-action-bar'>Show canvas controls</Label>
              <Switch
                id='show-action-bar'
                checked={settings?.showActionBar ?? true}
                onCheckedChange={handleShowActionBarChange}
              />
            </div>

            <div className='flex items-center justify-between'>
              <Label>Language</Label>
              <div className={DROPDOWN_TRIGGER_CLASS}>
                <LanguageSwitcher />
              </div>
            </div>

            {isTrainingEnabled && (
              <div className='flex items-center justify-between'>
                <Label htmlFor='training-controls'>Training controls</Label>
                <Switch
                  id='training-controls'
                  checked={settings?.showTrainingControls ?? false}
                  onCheckedChange={handleTrainingControlsChange}
                />
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection label='Privacy'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='telemetry'>Allow anonymous telemetry</Label>
              <Switch
                id='telemetry'
                checked={settings?.telemetryEnabled ?? true}
                onCheckedChange={handleTelemetryToggle}
              />
            </div>
            <p className='text-[var(--text-muted)] text-small'>
              We use OpenTelemetry to collect anonymous usage data to improve Sim. You can opt-out
              at any time.
            </p>
          </div>
        </SettingsSection>
      </SettingsPanel>

      <ChipModal
        open={showResetPasswordModal}
        onOpenChange={setShowResetPasswordModal}
        srTitle='Reset Password'
      >
        <ChipModalHeader onClose={() => setShowResetPasswordModal(false)}>
          Reset Password
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            A password reset link will be sent to{' '}
            <span className='font-medium text-[var(--text-primary)]'>{profile?.email}</span>. Click
            the link in the email to create a new password.
          </p>
          <ChipModalError>{resetPassword.error?.message}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setShowResetPasswordModal(false)}
          cancelDisabled={resetPassword.isPending || resetPassword.isSuccess}
          primaryAction={{
            label: resetPassword.isPending
              ? 'Sending...'
              : resetPassword.isSuccess
                ? 'Sent'
                : 'Send Reset Email',
            onClick: handleResetPasswordConfirm,
            disabled: resetPassword.isPending || resetPassword.isSuccess,
          }}
        />
      </ChipModal>
    </>
  )
}
