'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Lock, LogOut, User, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AgentIcon } from '@/components/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signOut, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { RequestResetForm } from '@/app/(auth)/reset-password/reset-password-form'
import { clearUserData } from '@/stores'

const logger = createLogger('Account')

interface AccountProps {
  onOpenChange: (open: boolean) => void
}

// Mock user data - in a real app, this would come from an auth provider
interface UserData {
  isLoggedIn: boolean
  name?: string
  email?: string
}

interface AccountData {
  id: string
  name: string
  email: string
  isActive?: boolean
}

export function Account({ onOpenChange }: AccountProps) {
  const router = useRouter()

  // In a real app, this would be fetched from an auth provider
  const [userData, setUserData] = useState<UserData>({
    isLoggedIn: false,
    name: '',
    email: '',
  })

  // Get session data using the client hook
  const { data: session, isPending, error } = useSession()
  const [isLoadingUserData, _setIsLoadingUserData] = useState(false)

  // Reset password states
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false)
  const [resetPasswordEmail, setResetPasswordEmail] = useState('')
  const [isSubmittingResetPassword, setIsSubmittingResetPassword] = useState(false)
  const [resetPasswordStatus, setResetPasswordStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  // Mock accounts for the multi-account UI
  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [open, setOpen] = useState(false)

  // Update user data when session changes
  useEffect(() => {
    const updateUserData = async () => {
      if (!isPending && session?.user) {
        // User is logged in
        setUserData({
          isLoggedIn: true,
          name: session.user.name || 'User',
          email: session.user.email,
        })

        setAccounts([
          {
            id: '1',
            name: session.user.name || 'User',
            email: session.user.email,
            isActive: true,
          },
        ])

        // Pre-fill the reset password email with the current user's email
        setResetPasswordEmail(session.user.email)
      } else if (!isPending) {
        // User is not logged in
        setUserData({
          isLoggedIn: false,
          name: '',
          email: '',
        })
        setAccounts([])
      }
    }

    updateUserData()
  }, [session, isPending])

  const handleSignIn = () => {
    // Use Next.js router to navigate to login page
    router.push('/login')
    setOpen(false)
  }

  const handleSignOut = async () => {
    try {
      // Start the sign-out process
      const signOutPromise = signOut()

      // Clear all user data to prevent persistence between accounts
      await clearUserData()

      // Set a short timeout to improve perceived performance
      // while still ensuring auth state starts to clear
      setTimeout(() => {
        router.push('/login?fromLogout=true')
      }, 100)

      // Still wait for the promise to resolve/reject to catch errors
      await signOutPromise
    } catch (error) {
      logger.error('Error signing out:', { error })
      // Still navigate even if there's an error
      router.push('/login?fromLogout=true')
    } finally {
      setOpen(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetPasswordEmail) {
      setResetPasswordStatus({
        type: 'error',
        message: 'Please enter your email address',
      })
      return
    }

    try {
      setIsSubmittingResetPassword(true)
      setResetPasswordStatus({ type: null, message: '' })

      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: resetPasswordEmail,
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to request password reset')
      }

      setResetPasswordStatus({
        type: 'success',
        message: 'Password reset link sent to your email',
      })

      // Close dialog after successful submission with a small delay for user to see success message
      setTimeout(() => {
        setResetPasswordDialogOpen(false)
        setResetPasswordStatus({ type: null, message: '' })
      }, 2000)
    } catch (error) {
      logger.error('Error requesting password reset:', { error })
      setResetPasswordStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to request password reset',
      })
    } finally {
      setIsSubmittingResetPassword(false)
    }
  }

  const activeAccount = accounts.find((acc) => acc.isActive) || accounts[0]

  // Loading animation component
  const LoadingAccountBlock = () => (
    <div className='group flex items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm'>
      <div className='flex items-center gap-3'>
        <div className='relative flex h-10 w-10 shrink-0 animate-pulse items-center justify-center overflow-hidden rounded-lg bg-muted'>
          <div
            className='absolute inset-0 animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent'
            style={{
              transform: 'translateX(-100%)',
              animation: 'shimmer 1.5s infinite',
            }}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <div className='h-4 w-24 animate-pulse rounded bg-muted' />
          <div className='h-3 w-32 animate-pulse rounded bg-muted' />
        </div>
      </div>
      <div className='h-4 w-4 rounded bg-muted' />
    </div>
  )

  return (
    <div className='space-y-6 p-6'>
      <div>
        <h3 className='mb-4 font-medium text-lg'>Account</h3>
      </div>

      {/* Account Dropdown Component */}
      <div className='max-w-xs'>
        <div className='relative'>
          {isPending || isLoadingUserData ? (
            <LoadingAccountBlock />
          ) : (
            <DropdownMenu open={open} onOpenChange={setOpen}>
              <DropdownMenuTrigger asChild>
                <div
                  className={cn(
                    'group flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-all',
                    'hover:bg-accent/50 hover:shadow-md',
                    open && 'bg-accent/50 shadow-md'
                  )}
                  data-state={open ? 'open' : 'closed'}
                >
                  <div className='flex items-center gap-3'>
                    <div className='relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-blue-500'>
                      {userData.isLoggedIn ? (
                        <div className='flex h-full w-full items-center justify-center bg-[#802FFF]'>
                          <AgentIcon className='-translate-y-[0.5px] text-white transition-transform duration-200 group-hover:scale-110' />
                        </div>
                      ) : (
                        <div className='flex h-full w-full items-center justify-center bg-gray-500'>
                          <AgentIcon className='text-white transition-transform duration-200 group-hover:scale-110' />
                        </div>
                      )}
                      {userData.isLoggedIn && accounts.length > 1 && (
                        <div className='-bottom-1 -right-1 absolute flex h-5 w-5 items-center justify-center rounded-full bg-primary font-medium text-[10px] text-primary-foreground'>
                          {accounts.length}
                        </div>
                      )}
                    </div>
                    <div className='mb-[-2px] flex flex-col gap-1'>
                      <h3 className='max-w-[200px] truncate font-medium leading-none'>
                        {userData.isLoggedIn ? activeAccount?.name : 'Sign in'}
                      </h3>
                      <p className='max-w-[200px] truncate text-muted-foreground text-sm'>
                        {userData.isLoggedIn ? activeAccount?.email : 'Click to sign in'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      open && 'rotate-180'
                    )}
                  />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='start'
                className='max-h-[350px] w-[280px] overflow-y-auto'
                sideOffset={8}
              >
                {userData.isLoggedIn ? (
                  <>
                    {accounts.length > 1 && (
                      <>
                        <div className='mb-2 px-2 py-1.5 font-medium text-muted-foreground text-sm'>
                          Switch Account
                        </div>
                        {accounts.map((account) => (
                          <DropdownMenuItem
                            key={account.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 p-3',
                              account.isActive && 'bg-accent'
                            )}
                          >
                            <div className='relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#802FFF]'>
                              <User className='h-4 w-4 text-white' />
                            </div>
                            <div className='flex flex-col'>
                              <span className='font-medium leading-none'>{account.name}</span>
                              <span className='text-muted-foreground text-xs'>{account.email}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      className='flex cursor-pointer items-center gap-2 py-2.5 pl-3'
                      onClick={() => {
                        setResetPasswordDialogOpen(true)
                        setOpen(false)
                      }}
                    >
                      <Lock className='h-4 w-4' />
                      <span>Reset Password</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className='flex cursor-pointer items-center gap-2 py-2.5 pl-3 text-destructive focus:text-destructive'
                      onClick={handleSignOut}
                    >
                      <LogOut className='h-4 w-4' />
                      <span>Sign Out</span>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      className='flex cursor-pointer items-center gap-2 py-2.5 pl-3'
                      onClick={handleSignIn}
                    >
                      <UserPlus className='h-4 w-4' />
                      <span>Sign in</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent className='sm:max-w-[425px]'>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <RequestResetForm
            email={resetPasswordEmail}
            onEmailChange={setResetPasswordEmail}
            onSubmit={handleResetPassword}
            isSubmitting={isSubmittingResetPassword}
            statusType={resetPasswordStatus.type}
            statusMessage={resetPasswordStatus.message}
            className='py-4'
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
