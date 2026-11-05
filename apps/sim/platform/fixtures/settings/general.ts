import { toRecord } from '@sim/utils/object'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'

interface FixtureProfile {
  id: string
  name: string
  email: string
  image: string | null
}

export function createGeneralFixture(profile: FixtureProfile) {
  const settings: Record<string, unknown> = {}
  return { profile: { ...profile }, settings }
}

/** Unset preferences take the same defaults as the API response contract. */
export async function generalFixture(request: Request, path: string, state: SettingsFixtureState) {
  const general = state.general
  if (path === '/api/users/me/settings') {
    if (request.method === 'GET') return { data: general.settings }
    if (request.method === 'PATCH') {
      general.settings = { ...general.settings, ...toRecord(await request.json()) }
      return { success: true }
    }
  }
  if (path === '/api/users/me/profile') {
    if (request.method === 'GET') return { user: general.profile }
    if (request.method === 'PATCH') {
      const update = toRecord(await request.json())
      if (typeof update.name === 'string') general.profile.name = update.name
      if (typeof update.image === 'string' || update.image === null)
        general.profile.image = update.image
      return { success: true, user: general.profile }
    }
  }
}
