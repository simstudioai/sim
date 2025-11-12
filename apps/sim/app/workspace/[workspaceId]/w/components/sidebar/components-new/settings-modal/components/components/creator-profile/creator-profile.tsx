'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, Check, Globe, Linkedin, Mail, Save, Twitter, User, Users } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AgentIcon } from '@/components/icons'
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/w/components/sidebar/components-new/settings-modal/components/account/hooks/use-profile-picture-upload'
import type { CreatorProfileDetails } from '@/types/creator-profile'

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

interface Organization {
  id: string
  name: string
  role: string
}

export function CreatorProfile() {
  const { data: session } = useSession()
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [existingProfile, setExistingProfile] = useState<any>(null)
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

  // Fetch organizations
  useEffect(() => {
    const fetchOrganizations = async () => {
      if (!session?.user?.id) return

      try {
        const response = await fetch('/api/organizations')
        if (response.ok) {
          const data = await response.json()
          const orgs = (data.organizations || []).filter(
            (org: any) => org.role === 'owner' || org.role === 'admin'
          )
          setOrganizations(orgs)
        }
      } catch (error) {
        logger.error('Error fetching organizations:', error)
      }
    }

    fetchOrganizations()
  }, [session?.user?.id])

  // Load existing profile
  useEffect(() => {
    const loadProfile = async () => {
      if (!session?.user?.id) return

      setLoading(true)
      try {
        const response = await fetch(`/api/creator-profiles?userId=${session.user.id}`)
        if (response.ok) {
          const data = await response.json()
          if (data.profiles && data.profiles.length > 0) {
            const profile = data.profiles[0]
            const details = profile.details as CreatorProfileDetails | null
            setExistingProfile(profile)
            form.reset({
              referenceType: profile.referenceType,
              referenceId: profile.referenceId,
              name: profile.name || '',
              profileImageUrl: profile.profileImageUrl || '',
              about: details?.about || '',
              xUrl: details?.xUrl || '',
              linkedinUrl: details?.linkedinUrl || '',
              websiteUrl: details?.websiteUrl || '',
              contactEmail: details?.contactEmail || '',
            })
          }
        }
      } catch (error) {
        logger.error('Error loading profile:', error)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [session?.user?.id, form])

  const onSubmit = async (data: CreatorProfileFormData) => {
    if (!session?.user?.id) return

    setSaveStatus('saving')
    try {
      const details: CreatorProfileDetails = {}
      if (data.about) details.about = data.about
      if (data.xUrl) details.xUrl = data.xUrl
      if (data.linkedinUrl) details.linkedinUrl = data.linkedinUrl
      if (data.websiteUrl) details.websiteUrl = data.websiteUrl
      if (data.contactEmail) details.contactEmail = data.contactEmail

      const payload = {
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        name: data.name,
        profileImageUrl: data.profileImageUrl,
        details: Object.keys(details).length > 0 ? details : undefined,
      }

      const url = existingProfile
        ? `/api/creator-profiles/${existingProfile.id}`
        : '/api/creator-profiles'
      const method = existingProfile ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const result = await response.json()
        setExistingProfile(result.data)
        logger.info('Creator profile saved successfully')
        setSaveStatus('saved')

        // Dispatch event to notify that a creator profile was saved
        window.dispatchEvent(new CustomEvent('creator-profile-saved'))

        setTimeout(() => {
          setSaveStatus('idle')
        }, 2000)
      } else {
        logger.error('Failed to save creator profile')
        setSaveStatus('error')
        setTimeout(() => {
          setSaveStatus('idle')
        }, 3000)
      }
    } catch (error) {
      logger.error('Error saving creator profile:', error)
      setSaveStatus('error')
      setTimeout(() => {
        setSaveStatus('idle')
      }, 3000)
    }
  }

  if (loading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto p-6'>
      <div className='mx-auto max-w-2xl space-y-6'>
        <div>
          <p className='text-muted-foreground text-sm'>
            Set up your creator profile for publishing templates
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            {/* Profile Type - only show if user has organizations */}
            {organizations.length > 0 && (
              <FormField
                control={form.control}
                name='referenceType'
                render={({ field }) => (
                  <FormItem className='space-y-3'>
                    <FormLabel>Profile Type</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className='flex flex-col space-y-1'
                      >
                        <div className='flex items-center space-x-3'>
                          <RadioGroupItem value='user' id='user' />
                          <label
                            htmlFor='user'
                            className='flex cursor-pointer items-center gap-2 font-normal text-sm'
                          >
                            <User className='h-4 w-4' />
                            Personal Profile
                          </label>
                        </div>
                        <div className='flex items-center space-x-3'>
                          <RadioGroupItem value='organization' id='organization' />
                          <label
                            htmlFor='organization'
                            className='flex cursor-pointer items-center gap-2 font-normal text-sm'
                          >
                            <Users className='h-4 w-4' />
                            Organization Profile
                          </label>
                        </div>
                      </RadioGroup>
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
                    <FormLabel>Organization</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder='Select organization' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                  <FormLabel>
                    Display Name <span className='text-destructive'>*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder='How your name appears on templates' {...field} />
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
                  <FormLabel>
                    <div className='flex items-center gap-2'>
                      <Camera className='h-4 w-4' />
                      Profile Picture <span className='text-destructive'>*</span>
                    </div>
                  </FormLabel>
                  <FormControl>
                    <div className='space-y-2'>
                      <div className='relative inline-block'>
                        <div
                          className='group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#802FFF] transition-all hover:opacity-80'
                          onClick={handleProfilePictureClick}
                        >
                          {profilePictureUrl ? (
                            <Image
                              src={profilePictureUrl}
                              alt='Profile picture'
                              width={96}
                              height={96}
                              className={`h-full w-full object-cover transition-opacity duration-300 ${
                                isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                              }`}
                            />
                          ) : (
                            <AgentIcon className='h-12 w-12 text-white' />
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
                              <div className='h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent' />
                            ) : (
                              <Camera className='h-6 w-6 text-white' />
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
                      {uploadError && <p className='text-destructive text-sm'>{uploadError}</p>}
                      <p className='text-muted-foreground text-xs'>PNG or JPEG (max 5MB)</p>
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
                  <FormLabel>About</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Tell people about yourself or your organization'
                      className='min-h-[120px] resize-none'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Social Links */}
            <div className='space-y-4'>
              <h3 className='font-medium text-sm'>Social Links</h3>

              <FormField
                control={form.control}
                name='xUrl'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <div className='flex items-center gap-2'>
                        <Twitter className='h-4 w-4' />X (Twitter)
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder='https://x.com/username' {...field} />
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
                    <FormLabel>
                      <div className='flex items-center gap-2'>
                        <Linkedin className='h-4 w-4' />
                        LinkedIn
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder='https://linkedin.com/in/username' {...field} />
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
                    <FormLabel>
                      <div className='flex items-center gap-2'>
                        <Globe className='h-4 w-4' />
                        Website
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder='https://yourwebsite.com' {...field} />
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
                    <FormLabel>
                      <div className='flex items-center gap-2'>
                        <Mail className='h-4 w-4' />
                        Contact Email
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder='contact@example.com' type='email' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type='submit'
              disabled={saveStatus === 'saving'}
              className={cn(
                'w-full transition-all duration-200',
                saveStatus === 'saved' && 'bg-green-600 hover:bg-green-700',
                saveStatus === 'error' && 'bg-red-600 hover:bg-red-700'
              )}
            >
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
              {saveStatus === 'error' && <>Error Saving</>}
              {saveStatus === 'idle' && (
                <>
                  <Save className='mr-2 h-4 w-4' />
                  {existingProfile ? 'Update Profile' : 'Create Profile'}
                </>
              )}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  )
}
