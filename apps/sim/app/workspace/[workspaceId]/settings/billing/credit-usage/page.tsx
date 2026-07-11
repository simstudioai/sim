import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAccountSettingsHref } from '@/components/settings/navigation'

export const metadata: Metadata = {
  title: 'Credit usage',
}

/** Preserves the legacy workspace-scoped URL after billing moved to account settings. */
export default function CreditUsagePage() {
  redirect(`${getAccountSettingsHref('billing')}/credit-usage`)
}
