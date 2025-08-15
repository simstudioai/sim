'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { AgentIcon } from '@/components/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { signOut, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { clearUserData } from '@/stores'

const logger = createLogger('Account')

interface AccountProps {
  onOpenChange: (open: boolean) => void
}

export function Account({ onOpenChange }: AccountProps) {
  const router = useRouter()

  // Get session data using the client hook
  const { data: session, isPending, error } = useSession()

  // Form states
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [userImage, setUserImage] = useState<string | null>(null)

  // Loading states
  const [isLoadingProfile, setIsLoadingProfile] = useState(false)
  const [isUpdatingName, setIsUpdatingName] = useState(false)

  // Error state
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // Edit states
  const [isEditingName, setIsEditingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch user profile on component mount
  useEffect(() => {
    const fetchProfile = async () => {
      if (!session?.user) return

      setIsLoadingProfile(true)
      setLoadError(null)

      try {
        const response = await fetch('/api/users/me/profile')
        if (!response.ok) {
          throw new Error('Failed to fetch profile')
        }

        const data = await response.json()
        setName(data.user.name)
        setEmail(data.user.email)
        setUserImage(data.user.image)
      } catch (error) {
        logger.error('Error fetching profile:', error)
        setLoadError('Failed to load profile data')
        // Fallback to session data
        if (session?.user) {
          setName(session.user.name || '')
          setEmail(session.user.email || '')
          setUserImage(session.user.image || null)
        }
      } finally {
        setIsLoadingProfile(false)
      }
    }

    fetchProfile()
  }, [session])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingName])

  const handleUpdateName = async () => {
    const trimmedName = name.trim()

    if (!trimmedName) {
      setUpdateError('Name cannot be empty')
      return
    }

    if (trimmedName === (session?.user?.name || '')) {
      setIsEditingName(false)
      return
    }

    setIsUpdatingName(true)
    setUpdateError(null)

    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update name')
      }

      setIsEditingName(false)
    } catch (error) {
      logger.error('Error updating name:', error)
      setUpdateError(error instanceof Error ? error.message : 'Failed to update name')
      setName(session?.user?.name || '')
    } finally {
      setIsUpdatingName(false)
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
    setName(session?.user?.name || '')
    setUpdateError(null)
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

  return (
    <div className='px-6 pt-4 pb-4'>
      {loadError && (
        <Alert variant='destructive' className='mb-4'>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {updateError && (
        <Alert variant='destructive' className='mb-4'>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>{updateError}</AlertDescription>
        </Alert>
      )}

      <div className='flex flex-col gap-6'>
        {isLoadingProfile || isPending ? (
          <>
            {/* User Info Section Skeleton */}
            <div className='flex items-center gap-4'>
              {/* User Avatar Skeleton */}
              <Skeleton className='h-10 w-10 rounded-full' />

              {/* User Details Skeleton */}
              <div className='flex flex-col'>
                <Skeleton className='mb-1 h-5 w-32' />
                <Skeleton className='h-5 w-48' />
              </div>
            </div>

            {/* Name Field Skeleton */}
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-16' />
              <div className='flex items-center gap-6'>
                <Skeleton className='h-5 w-40' />
                <Skeleton className='h-5 w-[42px]' />
              </div>
            </div>

            {/* Email Field Skeleton */}
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-5 w-48' />
            </div>

            {/* Sign Out Button Skeleton */}
            <div>
              <Skeleton className='h-8 w-[71px] rounded-[8px]' />
            </div>
          </>
        ) : (
          <>
            {/* User Info Section */}
            <div className='flex items-center gap-4'>
              {/* User Avatar */}
              <div className='relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#802FFF]'>
                {userImage ? (
                  <Image
                    src={userImage}
                    alt={name || 'User'}
                    width={40}
                    height={40}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <AgentIcon className='h-5 w-5 text-white' />
                )}
              </div>

              {/* User Details */}
              <div className='flex flex-col'>
                <h3 className='font-medium text-sm'>{name}</h3>
                <p className='font-normal text-muted-foreground text-sm'>{email}</p>
              </div>
            </div>

            {/* Name Field */}
            <div className='flex flex-col gap-2'>
              <Label htmlFor='name' className='font-normal text-muted-foreground text-xs'>
                Name
              </Label>
              {isEditingName ? (
                <input
                  ref={inputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleInputBlur}
                  className='min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                  maxLength={100}
                  disabled={isUpdatingName}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  spellCheck='false'
                />
              ) : (
                <div className='flex items-center gap-6'>
                  <span className='text-sm'>{name}</span>
                  <Button
                    variant='ghost'
                    className='h-auto p-0 font-normal text-muted-foreground text-xs transition-colors hover:bg-transparent hover:text-foreground'
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
              <Label className='font-normal text-muted-foreground text-xs'>Email</Label>
              <p className='text-sm'>{email}</p>
            </div>

            {/* Sign Out Button */}
            <div>
              <Button
                onClick={handleSignOut}
                variant='destructive'
                className='h-8 rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
              >
                Sign Out
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
