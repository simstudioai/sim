import { redirect } from 'next/navigation'
import { getAccountSettingsHref } from '@/components/settings/navigation'

export default function AccountSettingsPage() {
  redirect(getAccountSettingsHref('general'))
}
