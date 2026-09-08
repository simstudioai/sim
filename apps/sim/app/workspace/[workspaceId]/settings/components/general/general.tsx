'use client'

import { useEffect, useRef, useState } from 'react'
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
  cn,
  Input,
  Label,
  Switch,
  Tooltip,
} from '@sim/emcn'
import { Camera, Check, CircleInfo, Pencil } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { getBrowserTimezone, getTimezoneOptions } from '@/lib/core/utils/timezone'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { DeleteAccountModal } from '@/app/workspace/[workspaceId]/settings/components/general/components/delete-account-modal'
import { PrivacyView } from '@/app/workspace/[workspaceId]/settings/components/general/components/privacy-view'
import {
  generalViewParam,
  generalViewUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/general/search-params'
import {
  getTimezonePickerPresentation,
  timezonePreferenceFromPickerValue,
} from '@/app/workspace/[workspaceId]/settings/components/general/timezone-picker'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
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

const AuthorizedApps = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/authorized-apps/authorized-apps').then(
    (module) => module.AuthorizedApps
  )
)

const logger = createLogger('General')

/** Human-friendly timezone options for the picker, common zones first. */
const TIMEZONE_OPTIONS = getTimezoneOptions()

/**
 * Shared trigger width for the three appearance dropdowns (Theme, Timezone, Snap
 * to grid) so they line up as one column instead of three differently-sized
 * pills. Wide enough for the longest common timezone label.
 */
const DROPDOWN_TRIGGER_CLASS = 'w-[240px] shrink-0'

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
  const { hosted } = useDeploymentShape()

  const { data: profile, isLoading: isProfileLoading } = useUserProfile()
  const updateProfile = useUpdateUserProfile()

  const { data: settings, isLoading: isSettingsLoading } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()

  const isLoading = isProfileLoading || isSettingsLoading

  const isAuthDisabled = session?.user?.id === ANONYMOUS_USER_ID

  const [name, setName] = useState(profile?.name || '')
  const [isEditingName, setIsEditingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevProfileNameRef = useRef<string | undefined>(profile?.name)

  if (profile?.name && profile.name !== prevProfileNameRef.current) {
    prevProfileNameRef.current = profile.name
    setName(profile.name)
  }

  const [view, setView] = useQueryState(generalViewParam.key, {
    ...generalViewParam.parser,
    ...generalViewUrlKeys,
  })
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false)
  const resetPassword = useResetPassword()

  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false)

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
    const logoutUrl = '/login?fromLogout=true'
    let canNavigateInApp = false

    try {
      const [, inMemoryResetSucceeded] = await Promise.all([signOut(), clearUserData()])
      canNavigateInApp = inMemoryResetSucceeded
    } catch (error) {
      logger.error('Error signing out:', { error })
    }

    if (canNavigateInApp) router.push(logoutUrl)
    else window.location.assign(logoutUrl)
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
    const timezone = timezonePreferenceFromPickerValue(value)
    if (timezone === undefined) return
    await updateSetting.mutateAsync({
      key: 'timezone',
      value: timezone,
    })
  }

  const handleAutoConnectChange = async (checked: boolean) => {
    if (checked !== settings?.autoConnect && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'autoConnect', value: checked })
    }
  }

  const handleAutoFocusOnClickChange = async (checked: boolean) => {
    if (checked !== settings?.autoFocusOnClick && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'autoFocusOnClick', value: checked })
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

  const handleErrorNotificationsChange = async (checked: boolean) => {
    if (checked !== settings?.errorNotificationsEnabled && !updateSetting.isPending) {
      await updateSetting.mutateAsync({ key: 'errorNotificationsEnabled', value: checked })
    }
  }

  const imageUrl = profilePictureUrl || profile?.image || brandConfig.logoUrl

  if (view === 'privacy') {
    return <PrivacyView onBack={() => setView(null, { history: 'replace' })} />
  }

  if (view === 'authorized-apps' && !isAuthDisabled) {
    return <AuthorizedApps onBack={() => setView(null, { history: 'replace' })} />
  }

  const actions: SettingsAction[] = [
    ...(hosted
      ? [
          {
            id: 'home-page',
            text: 'Home page',
            onSelect: () => window.open('/?home', '_blank', 'noopener,noreferrer'),
          },
        ]
      : []),
    ...(session?.user?.id && !isAuthDisabled
      ? [
          { id: 'sign-out', text: 'Sign out', onSelect: handleSignOut },
          {
            id: 'reset-password',
            text: 'Reset password',
            onSelect: () => setShowResetPasswordModal(true),
            disabled: !profile?.email,
          },
        ]
      : []),
  ]

  if (isLoading) {
    return <SettingsPanel actions={actions} />
  }

  const browserTimezone = getBrowserTimezone()
  const savedTimezone = settings?.timezone ?? null
  const timezonePicker = getTimezonePickerPresentation(
    savedTimezone,
    browserTimezone,
    TIMEZONE_OPTIONS
  )

  return (
    <>
      <SettingsPanel actions={actions}>
        <SettingsSection label='Profile'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
              <div className='relative'>
                <button
                  type='button'
                  aria-label='Change profile picture'
                  className={cn(
                    'group relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full transition-colors hover-hover:bg-[var(--bg)]',
                    !imageUrl && 'border border-[var(--border)]'
                  )}
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
                          unoptimized
                          className={`h-full w-full object-cover transition-opacity duration-300 ${
                            isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                          }`}
                        />
                      )
                    }
                    return (
                      <span className='text-[var(--text-primary)] text-base'>
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
                </button>
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
                        <span className='invisible whitespace-pre text-base' aria-hidden='true'>
                          {name || ' '}
                        </span>
                        <input
                          ref={inputRef}
                          aria-label='Your name'
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={handleInputBlur}
                          className='absolute top-0 left-0 h-full w-full border-0 bg-transparent p-0 text-base outline-hidden focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
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
                        className='size-[12px] shrink-0 p-0'
                        onClick={handleUpdateName}
                        disabled={updateProfile.isPending}
                        aria-label='Save name'
                      >
                        <Check className='size-[12px]' />
                      </Button>
                    </>
                  ) : (
                    <>
                      <h3 className='text-base'>{profile?.name || ''}</h3>
                      <Button
                        variant='ghost'
                        className='size-[10.5px] shrink-0 p-0'
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
              <Label>Theme</Label>
              <div className={DROPDOWN_TRIGGER_CLASS}>
                <ChipSelect
                  aria-label='Theme'
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
                  value={timezonePicker.value}
                  onChange={handleTimezoneChange}
                  placeholder='Select timezone'
                  options={timezonePicker.options}
                />
              </div>
            </div>

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-1.5'>
                <Label htmlFor='auto-connect'>Auto-connect on drop</Label>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      aria-label='About auto-connect on drop'
                      className='inline-flex cursor-default text-[var(--text-muted)]'
                    >
                      <CircleInfo className='size-[14px]' />
                    </button>
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
                <Label htmlFor='auto-focus-on-click'>Auto-focus on click</Label>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      aria-label='About auto-focus on click'
                      className='inline-flex cursor-default text-[var(--text-muted)]'
                    >
                      <CircleInfo className='size-[14px]' />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom' align='start'>
                    <p>Center the canvas on a block when you click it</p>
                    <Tooltip.Preview
                      src='/tooltips/auto-focus-on-click.mp4'
                      alt='Auto-focus on click example'
                      loop={true}
                    />
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
              <Switch
                id='auto-focus-on-click'
                checked={settings?.autoFocusOnClick ?? true}
                onCheckedChange={handleAutoFocusOnClickChange}
              />
            </div>

            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-1.5'>
                <Label htmlFor='error-notifications'>Canvas error notifications</Label>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      aria-label='About canvas error notifications'
                      className='inline-flex cursor-default text-[var(--text-muted)]'
                    >
                      <CircleInfo className='size-[14px]' />
                    </button>
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
              <Label>Snap to grid</Label>
              <div className={DROPDOWN_TRIGGER_CLASS}>
                <ChipSelect
                  aria-label='Snap to grid'
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
          </div>
        </SettingsSection>

        <SettingsSection label='Privacy'>
          <div className='flex items-center justify-between'>
            <Label>Privacy settings</Label>
            <Chip onClick={() => setView('privacy')}>Manage</Chip>
          </div>
        </SettingsSection>

        {!isAuthDisabled && (
          <SettingsSection label='Account'>
            <div className='flex flex-col gap-4'>
              <div className='flex items-center justify-between'>
                <Label>Authorized apps</Label>
                <Chip onClick={() => setView('authorized-apps')}>Manage</Chip>
              </div>
              <div className='flex items-center justify-between'>
                <Label>Delete account</Label>
                <Chip onClick={() => setShowDeleteAccountModal(true)}>Delete</Chip>
              </div>
            </div>
          </SettingsSection>
        )}
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
            <span className='text-[var(--text-primary)]'>{profile?.email}</span>. Click the link in
            the email to create a new password.
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

      <DeleteAccountModal
        open={showDeleteAccountModal}
        onOpenChange={setShowDeleteAccountModal}
        email={profile?.email || ''}
      />
    </>
  )
}
