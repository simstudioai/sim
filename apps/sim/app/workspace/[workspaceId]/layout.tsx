import { Banner, Button, ToastProvider } from '@/components/emcn'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useSession } from '@/lib/auth/auth-client'
import { useStopImpersonating } from '@/hooks/queries/admin-users'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

function ImpersonationBanner() {
  const { data: session, isPending } = useSession()
  const stopImpersonating = useStopImpersonating()
  const userLabel = session?.user?.name || 'this user'
  const userEmail = session?.user?.email

  if (isPending || !session?.session?.impersonatedBy) {
    return null
  }

  return (
    <Banner variant='destructive'>
      <div className='mx-auto flex max-w-[1400px] items-center justify-between gap-[12px]'>
        <p className='text-[13px] text-red-700 dark:text-red-300'>
          Impersonating {userLabel}
          {userEmail ? ` (${userEmail})` : ''}. Changes will apply to this account until you switch
          back.
        </p>
        <Button
          variant='destructive'
          className='h-[28px] shrink-0 px-[8px] text-[12px]'
          onClick={() =>
            stopImpersonating.mutate(undefined, {
              onSuccess: () => {
                window.location.assign('/workspace')
              },
            })
          }
          disabled={stopImpersonating.isPending}
        >
          {stopImpersonating.isPending ? 'Returning...' : 'Stop impersonating'}
        </Button>
      </div>
    </Banner>
  )
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SettingsLoader />
      <ProviderModelsLoader />
      <GlobalCommandsProvider>
        <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
          <ImpersonationBanner />
          <WorkspacePermissionsProvider>
            <div className='flex min-h-0 flex-1'>
              <div className='shrink-0' suppressHydrationWarning>
                <Sidebar />
              </div>
              <div className='flex min-w-0 flex-1 flex-col p-[8px] pl-0'>
                <div className='flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
                  {children}
                </div>
              </div>
            </div>
          </WorkspacePermissionsProvider>
        </div>
      </GlobalCommandsProvider>
    </ToastProvider>
  )
}
