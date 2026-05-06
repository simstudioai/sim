import type { Metadata } from 'next'
import Invite from '@/app/invite/[id]/invite'

export const metadata: Metadata = {
  title: 'Invite',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

export default Invite
