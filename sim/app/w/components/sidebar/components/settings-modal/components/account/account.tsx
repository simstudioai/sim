'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut, Plus, User, UserPlus } from 'lucide-react'
import { AgentIcon } from '@/components/icons'
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
  const [isLoadingUserData, setIsLoadingUserData] = useState(false)

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

  const activeAccount = accounts.find((acc) => acc.isActive) || accounts[0]

  // Loading animation component
  const LoadingAccountBlock = () => (
    <div className="group flex items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted animate-pulse">
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite]"
            style={{
              transform: 'translateX(-100%)',
              animation: 'shimmer 1.5s infinite',
            }}
          ></div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="h-4 w-24 bg-muted rounded animate-pulse"></div>
          <div className="h-3 w-32 bg-muted rounded animate-pulse"></div>
        </div>
      </div>
      <div className="h-4 w-4 bg-muted rounded"></div>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Account</h3>
      </div>

      {/* Account Dropdown Component */}
      <div className="max-w-xs">
        <div className="relative">
          {isPending || isLoadingUserData ? (
            <LoadingAccountBlock />
          ) : (
            <DropdownMenu open={open} onOpenChange={setOpen}>
              <DropdownMenuTrigger asChild>
                <div
                  className={cn(
                    'group flex items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-all cursor-pointer',
                    'hover:bg-accent/50 hover:shadow-md',
                    open && 'bg-accent/50 shadow-md'
                  )}
                  data-state={open ? 'open' : 'closed'}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-blue-500">
                      {userData.isLoggedIn ? (
                        <div className="h-full w-full flex items-center justify-center bg-[#7F2FFF]">
                          <AgentIcon className="text-white transition-transform duration-200 group-hover:scale-110 -translate-y-[0.5px]" />
                        </div>
                      ) : (
                        <div className="bg-gray-500 h-full w-full flex items-center justify-center">
                          <AgentIcon className="text-white transition-transform duration-200 group-hover:scale-110" />
                        </div>
                      )}
                      {userData.isLoggedIn && accounts.length > 1 && (
                        <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                          {accounts.length}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 mb-[-2px]">
                      <h3 className="font-medium leading-none truncate max-w-[160px]">
                        {userData.isLoggedIn ? activeAccount?.name : 'Sign in'}
                      </h3>
                      <p className="text-sm text-muted-foreground truncate max-w-[160px]">
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
                align="start"
                className="w-[240px] max-h-[350px] overflow-y-auto"
                sideOffset={8}
              >
                {userData.isLoggedIn ? (
                  <>
                    {accounts.length > 1 && (
                      <>
                        <div className="mb-2 px-2 py-1.5 text-sm font-medium text-muted-foreground">
                          Switch Account
                        </div>
                        {accounts.map((account) => (
                          <DropdownMenuItem
                            key={account.id}
                            className={cn(
                              'flex items-center gap-2 p-3 cursor-pointer',
                              account.isActive && 'bg-accent'
                            )}
                          >
                            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#7F2FFF]">
                              <User className="text-white w-4 h-4" />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-medium leading-none">{account.name}</span>
                              <span className="text-xs text-muted-foreground">{account.email}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      className="flex items-center gap-2 pl-3 py-2.5 cursor-pointer text-destructive focus:text-destructive"
                      onClick={handleSignOut}
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign Out</span>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem
                      className="flex items-center gap-2 pl-3 py-2.5 cursor-pointer"
                      onClick={handleSignIn}
                    >
                      <UserPlus className="h-4 w-4" />
                      <span>Sign in</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  )
}
