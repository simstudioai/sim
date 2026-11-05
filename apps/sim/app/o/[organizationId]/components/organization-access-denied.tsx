import Link from 'next/link'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { RouteStatus } from '@/platform/app/(shell)/_components/route-status/route-status'
import { Button } from '@/platform/design-system/components/button/button'

export function OrganizationAccessDenied() {
  return (
    <main className='desktop-title-bar-page flex bg-[var(--surface-1)]'>
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
