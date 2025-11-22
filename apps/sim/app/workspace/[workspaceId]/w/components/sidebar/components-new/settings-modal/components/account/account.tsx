'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { AgentIcon } from '@/components/icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signOut } from '@/lib/auth-client'
import { useBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components/account/hooks/use-profile-picture-upload'
import { useUpdateUserProfile, useUserProfile } from '@/hooks/queries/user-profile'
import { clearUserData } from '@/stores'

const logger = createLogger('Account')

interface AccountProps {
  onOpenChange: (open: boolean) => void
}

export function Account(_props: AccountProps) {
  const router = useRouter()
  const brandConfig = useBrandConfig()

  // React Query hooks - with placeholderData to show cached data immediately
  const { data: profile } = useUserProfile()
  const updateProfile = useUpdateUserProfile()

  // Local UI state
  const [name, setName] = useState(profile?.name || '')
  const [isEditingName, setIsEditingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [resetPasswordMessage, setResetPasswordMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [uploadError, setUploadError] = useState<string | null>(null)

  // Update local name state when profile data changes
  useEffect(() => {
    if (profile?.name) {
      setName(profile.name)
    }
  }, [profile?.name])

  const {
    previewUrl: profilePictureUrl,
    fileInputRef: profilePictureInputRef,
    handleThumbnailClick: handleProfilePictureClick,
    handleFileChange: handleProfilePictureChange,
    isUploading: isUploadingProfilePicture,
  } = useProfilePictureUpload({
    currentImage: profile?.image || null,
    onUpload: async (url) => {
      try {
        await updateProfile.mutateAsync({ image: url })
        setUploadError(null)
      } catch (error) {
        setUploadError(
          url ? 'Failed to update profile picture' : 'Failed to remove profile picture'
        )
      }
    },
    onError: (error) => {
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

  const handleResetPassword = async () => {
    if (!profile?.email) return

    setIsResettingPassword(true)
    setResetPasswordMessage(null)

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

      setResetPasswordMessage({
        type: 'success',
        text: 'email sent',
      })

      setTimeout(() => {
        setResetPasswordMessage(null)
      }, 5000)
    } catch (error) {
      logger.error('Error resetting password:', error)
      setResetPasswordMessage({
        type: 'error',
        text: 'error',
      })

      setTimeout(() => {
        setResetPasswordMessage(null)
      }, 5000)
    } finally {
      setIsResettingPassword(false)
    }
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-4'>
        {/* User Info Section */}
        <div className='flex items-center gap-4'>
          {/* Profile Picture Upload */}
          <div className='relative'>
            <div
              className='group relative flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#802FFF] transition-all hover:opacity-80'
              onClick={handleProfilePictureClick}
            >
              {(() => {
                const imageUrl = profilePictureUrl || profile?.image || brandConfig.logoUrl
                return imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt={profile?.name || 'User'}
                    width={48}
                    height={48}
                    className={`h-full w-full object-cover transition-opacity duration-300 ${
                      isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                    }`}
                  />
                ) : (
                  <AgentIcon className='h-6 w-6 text-white' />
                )
              })()}

              {/* Upload overlay */}
              <div
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/50 transition-opacity ${
                  isUploadingProfilePicture ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {isUploadingProfilePicture ? (
                  <div className='h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent' />
                ) : (
                  <Camera className='h-5 w-5 text-white' />
                )}
              </div>
            </div>

            {/* Hidden file input */}
            <Input
              type='file'
              accept='image/png,image/jpeg,image/jpg'
              className='hidden'
              ref={profilePictureInputRef}
              onChange={handleProfilePictureChange}
              disabled={isUploadingProfilePicture}
            />
          </div>

          {/* User Details */}
          <div className='flex flex-1 flex-col justify-center'>
            <h3 className='font-medium text-base'>{profile?.name || ''}</h3>
            <p className='font-normal text-muted-foreground text-sm'>{profile?.email || ''}</p>
            {uploadError && (
              <p className='mt-1 text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {uploadError}
              </p>
            )}
          </div>
        </div>

        {/* Name Field */}
        <div className='flex flex-col gap-2'>
          <Label htmlFor='name' className='font-normal text-muted-foreground text-sm'>
            Name
          </Label>
          {isEditingName ? (
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className='min-w-0 flex-1 border-0 bg-transparent p-0 text-base outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              maxLength={100}
              disabled={updateProfile.isPending}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          ) : (
            <div className='flex items-center gap-4'>
              <span className='text-base'>{profile?.name || ''}</span>
              <Button
                variant='ghost'
                className='h-auto p-0 font-normal text-muted-foreground text-sm transition-colors hover:bg-transparent hover:text-foreground'
                onClick={() => setIsEditingName(true)}
              >
                update
                <span className='sr-only'>Update name</span>
              </Button>
            </div>
          )}
        </div>

        {/* Email Field - Read Only */}
        <div className='flex flex-col gap-2'>
          <Label className='font-normal text-muted-foreground text-sm'>Email</Label>
          <p className='text-base'>{profile?.email || ''}</p>
        </div>

        {/* Password Field */}
        <div className='flex flex-col gap-2'>
          <Label className='font-normal text-muted-foreground text-sm'>Password</Label>
          <div className='flex items-center gap-4'>
            <span className='text-base'>••••••••</span>
            <Button
              variant='ghost'
              className={`h-auto p-0 font-normal text-sm transition-colors hover:bg-transparent ${
                resetPasswordMessage
                  ? resetPasswordMessage.type === 'success'
                    ? 'text-green-500 hover:text-green-600'
                    : 'text-destructive hover:text-destructive/80'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={handleResetPassword}
              disabled={isResettingPassword}
            >
              {isResettingPassword
                ? 'sending...'
                : resetPasswordMessage
                  ? resetPasswordMessage.text
                  : 'reset'}
              <span className='sr-only'>Reset password</span>
            </Button>
          </div>
        </div>

        {/* Sign Out Button */}
        <div>
          <Button onClick={handleSignOut} variant='outline'>
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  )
}
