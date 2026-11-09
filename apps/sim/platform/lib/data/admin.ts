import 'server-only'
import { getUserSettingsContract } from '@/lib/api/contracts/user'
import { getCurrentUserSettingsUseCase } from '@/lib/users/application/read-current-user'
import type { AdminPreferences } from '@/platform/app/(shell)/settings/_components/sections/admin/model'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'

export async function readAdminPreferences(): Promise<AdminPreferences> {
  const { principal } = await requireSessionViewer()
  const { data } = await asRouteResponse(getUserSettingsContract, {
    data: await getCurrentUserSettingsUseCase.execute({ principal, input: {} }),
  })
  return {
    superUserModeEnabled: data.superUserModeEnabled,
    mothershipEnvironment: data.mothershipEnvironment,
  }
}
