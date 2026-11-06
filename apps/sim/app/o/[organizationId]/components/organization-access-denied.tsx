import { cn } from '@sim/emcn'
import Link from 'next/link'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { Button } from '@/platform/design-system/components/button/button'
import hostBridge from '@/platform/design-system/styles/host-bridge.module.css'
import { RouteStatus } from '@/platform/embedded/app/(shell)/_components/route-status/route-status'

export function OrganizationAccessDenied() {
  return (
    <main
      className={cn(
        'desktop-title-bar-page flex min-h-dvh bg-[var(--bg)]',
        hostBridge.tokens,
        hostBridge.canvas
      )}
    >
      <DesktopTitleBarLane />
      <RouteStatus
        title='Organization access denied'
        description='You are not a member of this organization. Ask an organization admin to add you, or head back to your workspaces.'
        actions={
          <Button variant='primary' render={<Link href={WORKSPACES_PATH} />}>
            View your workspaces
          </Button>
        }
      />
    </main>
  )
}
