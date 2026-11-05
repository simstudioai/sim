import 'server-only'
import { getUserSettingsContract } from '@/lib/api/contracts/user'
import type { AdminPreferences } from '@/platform/app/(shell)/settings/_components/sections/admin/model'
import { serverRequestJson } from '@/platform/lib/data/server-request'

export async function readAdminPreferences(): Promise<AdminPreferences> {
  const { data } = await serverRequestJson(getUserSettingsContract, {})
  return {
    superUserModeEnabled: data.superUserModeEnabled,
    mothershipEnvironment: data.mothershipEnvironment,
  }
}
