import { redirect } from 'next/navigation'
import { ToastProvider } from '@/components/emcn'
import { getSession } from '@/lib/auth'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { BrandingProvider } from '@/ee/whitelabeling/components/branding-provider'
import { getOrgWhitelabelSettings } from '@/ee/whitelabeling/org-branding'

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }
  // The organization plugin is conditionally spread so TS can't infer activeOrganizationId on the base session type.
  const orgId = (session.session as { activeOrganizationId?: string } | null)?.activeOrganizationId
  const initialOrgSettings = orgId ? await getOrgWhitelabelSettings(orgId) : null

  return (
    <BrandingProvider initialOrgSettings={initialOrgSettings}>
      <ToastProvider>
        <SettingsLoader />
        <ProviderModelsLoader />
        <GlobalCommandsProvider>
          <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
            <ImpersonationBanner />
            <WorkspacePermissionsProvider>
              <WorkspaceScopeSync />
              <WorkspaceChrome>{children}</WorkspaceChrome>
            </WorkspacePermissionsProvider>
          </div>
        </GlobalCommandsProvider>
      </ToastProvider>
    </BrandingProvider>
  )
}
