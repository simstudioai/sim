'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, Check, User, Users } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, Combobox, Input, Textarea } from '@/components/emcn'
import { AgentIcon } from '@/components/icons'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import type { CreatorProfileDetails } from '@/app/_types/creator-profile'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components/account/hooks/use-profile-picture-upload'
import {
  useCreatorProfile,
  useOrganizations,
  useSaveCreatorProfile,
} from '@/hooks/queries/creator-profile'

const logger = createLogger('CreatorProfile')

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const creatorProfileSchema = z.object({
  referenceType: z.enum(['user', 'organization']),
  referenceId: z.string().min(1, 'Reference is required'),
  name: z.string().min(1, 'Display Name is required').max(100, 'Max 100 characters'),
  profileImageUrl: z.string().min(1, 'Profile Picture is required'),
  about: z.string().max(2000, 'Max 2000 characters').optional(),
  xUrl: z.string().url().optional().or(z.literal('')),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
})

type CreatorProfileFormData = z.infer<typeof creatorProfileSchema>

export function CreatorProfile() {
  const { data: session } = useSession()
  const userId = session?.user?.id || ''

  // React Query hooks - with placeholderData to show cached data immediately
  const { data: organizations = [] } = useOrganizations()
  const { data: existingProfile } = useCreatorProfile(userId)
  const saveProfile = useSaveCreatorProfile()

  // Local UI state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const form = useForm<CreatorProfileFormData>({
    resolver: zodResolver(creatorProfileSchema),
    defaultValues: {
      referenceType: 'user',
      referenceId: session?.user?.id || '',
      name: session?.user?.name || session?.user?.email || '',
      profileImageUrl: '',
      about: '',
      xUrl: '',
      linkedinUrl: '',
      websiteUrl: '',
      contactEmail: '',
    },
  })

  const profileImageUrl = form.watch('profileImageUrl')

  const {
    previewUrl: profilePictureUrl,
    fileInputRef: profilePictureInputRef,
    handleThumbnailClick: handleProfilePictureClick,
    handleFileChange: handleProfilePictureChange,
    isUploading: isUploadingProfilePicture,
  } = useProfilePictureUpload({
    currentImage: profileImageUrl,
    onUpload: async (url) => {
      form.setValue('profileImageUrl', url || '')
      setUploadError(null)
    },
    onError: (error) => {
      setUploadError(error)
      setTimeout(() => setUploadError(null), 5000)
    },
  })

  const referenceType = form.watch('referenceType')

  // Update form when profile data loads
  useEffect(() => {
    if (existingProfile) {
      const details = existingProfile.details as CreatorProfileDetails | null
      form.reset({
        referenceType: existingProfile.referenceType,
        referenceId: existingProfile.referenceId,
        name: existingProfile.name || '',
        profileImageUrl: existingProfile.profileImageUrl || '',
        about: details?.about || '',
        xUrl: details?.xUrl || '',
        linkedinUrl: details?.linkedinUrl || '',
        websiteUrl: details?.websiteUrl || '',
        contactEmail: details?.contactEmail || '',
      })
    }
  }, [existingProfile, form])

  const [saveError, setSaveError] = useState<string | null>(null)

  const onSubmit = async (data: CreatorProfileFormData) => {
    if (!userId) return

    setSaveStatus('saving')
    setSaveError(null)

    try {
      const details: CreatorProfileDetails = {}
      if (data.about) details.about = data.about
      if (data.xUrl) details.xUrl = data.xUrl
      if (data.linkedinUrl) details.linkedinUrl = data.linkedinUrl
      if (data.websiteUrl) details.websiteUrl = data.websiteUrl
      if (data.contactEmail) details.contactEmail = data.contactEmail

      await saveProfile.mutateAsync({
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        name: data.name,
        profileImageUrl: data.profileImageUrl,
        details: Object.keys(details).length > 0 ? details : undefined,
        existingProfileId: existingProfile?.id,
      })

      setSaveStatus('saved')

      // Reset to idle after 2 seconds
      setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)
    } catch (error) {
      logger.error('Error saving creator profile:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to save creator profile'
      setSaveError(errorMessage)
      setSaveStatus('idle')
    }
  }

  return (
    <div className='relative flex h-full flex-col'>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='flex h-full flex-col'>
          {/* Scrollable Content */}
          <div className='min-h-0 flex-1 overflow-y-auto px-6'>
            <div className='space-y-2 pt-2 pb-6'>
              {/* Profile Type - only show if user has organizations */}
              {organizations.length > 0 && (
                <FormField
                  control={form.control}
                  name='referenceType'
                  render={({ field }) => (
                    <FormItem className='space-y-2'>
                      <FormLabel className='font-[360] text-sm'>Profile Type</FormLabel>
                      <FormControl>
                        <div className='flex gap-2'>
                          <Button
                            type='button'
                            variant={field.value === 'user' ? 'outline' : 'default'}
                            onClick={() => field.onChange('user')}
                            className='h-8'
                          >
                            <User className='mr-1.5 h-3.5 w-3.5' />
                            Personal
                          </Button>
                          <Button
                            type='button'
                            variant={field.value === 'organization' ? 'outline' : 'default'}
                            onClick={() => field.onChange('organization')}
                            className='h-8'
                          >
                            <Users className='mr-1.5 h-3.5 w-3.5' />
                            Organization
                          </Button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Reference Selection */}
              {referenceType === 'organization' && organizations.length > 0 && (
                <FormField
                  control={form.control}
                  name='referenceId'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-[360] text-sm'>Organization</FormLabel>
                      <FormControl>
                        <Combobox
                          options={organizations.map((org) => ({
                            label: org.name,
                            value: org.id,
                          }))}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder='Select organization'
                          editable={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Profile Name */}
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='font-normal text-[13px]'>
                      Display Name <span className='text-destructive'>*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder='How your name appears on templates'
                        {...field}
                        className='h-9 w-full'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Profile Picture Upload */}
              <FormField
                control={form.control}
                name='profileImageUrl'
                render={() => (
                  <FormItem>
                    <FormLabel className='font-normal text-[13px]'>
                      Profile Picture <span className='text-destructive'>*</span>
                    </FormLabel>
                    <FormControl>
                      <div className='flex items-center gap-3'>
                        <div className='relative inline-block'>
                          <div
                            className='group relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#802FFF] transition-all hover:opacity-80'
                            onClick={handleProfilePictureClick}
                          >
                            {profilePictureUrl ? (
                              <Image
                                src={profilePictureUrl}
                                alt='Profile picture'
                                width={64}
                                height={64}
                                className={`h-full w-full object-cover transition-opacity duration-300 ${
                                  isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                                }`}
                              />
                            ) : (
                              <AgentIcon className='h-8 w-8 text-white' />
                            )}

                            {/* Upload overlay */}
                            <div
                              className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/50 transition-opacity ${
                                isUploadingProfilePicture
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              {isUploadingProfilePicture ? (
                                <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
                              ) : (
                                <Camera className='h-4 w-4 text-white' />
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
                        <div className='flex flex-col gap-1'>
                          {uploadError && (
                            <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                              {uploadError}
                            </p>
                          )}
                          <p className='text-muted-foreground text-xs'>PNG or JPEG (max 5MB)</p>
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* About */}
              <FormField
                control={form.control}
                name='about'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='font-normal text-[13px]'>About</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Tell people about yourself or your organization'
                        className='min-h-[120px] w-full resize-none'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Social Links */}
              <div className='space-y-4'>
                <div className='font-medium text-[13px] text-foreground'>Social Links</div>

                <FormField
                  control={form.control}
                  name='xUrl'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2 font-normal text-[13px]'>
                        X (Twitter)
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder='https://x.com/username'
                          {...field}
                          className='h-9 w-full'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='linkedinUrl'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2 font-normal text-[13px]'>
                        LinkedIn
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder='https://linkedin.com/in/username'
                          {...field}
                          className='h-9 w-full'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='websiteUrl'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2 font-normal text-[13px]'>
                        Website
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder='https://yourwebsite.com'
                          {...field}
                          className='h-9 w-full'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='contactEmail'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='flex items-center gap-2 font-normal text-[13px]'>
                        Contact Email
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder='contact@example.com'
                          type='email'
                          {...field}
                          className='h-9 w-full'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>

          {/* Error Message */}
          {saveError && (
            <div className='px-6 pb-2'>
              <p className='text-[#DC2626] text-[11px] leading-tight dark:text-[#F87171]'>
                {saveError}
              </p>
            </div>
          )}

          {/* Footer */}
          <div className='bg-background'>
            <div className='flex w-full items-center justify-between px-6 py-4'>
              <div className='text-muted-foreground text-xs'>
                Set up your creator profile for publishing templates
              </div>
              <Button type='submit' disabled={saveStatus === 'saving'} className='h-9'>
                {saveStatus === 'saving' && (
                  <>
                    <div className='mr-2 h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
                    Saving...
                  </>
                )}
                {saveStatus === 'saved' && (
                  <>
                    <Check className='mr-2 h-4 w-4' />
                    Saved
                  </>
                )}
                {saveStatus === 'idle' && (
                  <>{existingProfile ? 'Update Profile' : 'Create Profile'}</>
                )}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
