import { redirect } from 'next/navigation'
import { getSelfHostSettingsHref } from '@/components/settings/navigation'

export default function SelfHostSettingsPage() {
  redirect(getSelfHostSettingsHref('general'))
}
