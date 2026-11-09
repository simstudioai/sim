import type { Metadata } from 'next'
import { SITE_NOT_FOUND_METADATA, SiteNotFound } from '@/app/_shell/status-not-found'

export const metadata: Metadata = SITE_NOT_FOUND_METADATA

export default function NotFound() {
  return <SiteNotFound />
}
