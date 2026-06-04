import type { Metadata } from 'next'
import Unsubscribe from '@/app/unsubscribe/unsubscribe'

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

export default Unsubscribe
