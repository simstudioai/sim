import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { settings, user } from '@sim/db/schema'
import { generateShortId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import {
  type UpdateUserProfileBody,
  type UserProfileApiUser,
  updateUserProfileBodySchema,
  updateUserSettingsBodySchema,
} from '@/lib/api/contracts/user'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { invalidateSuperUserGate } from '@/lib/mothership/server/agent-url'
import { userAccountOperations } from '@/lib/users/application/operations'
import { authorizeAccountPreferences } from '@/lib/users/application/preferences-authorization'
import { defaultUserSettings } from '@/lib/users/queries'

export type UpdateAccountPreferencesInput = z.output<typeof updateUserSettingsBodySchema>

/** The durable preferences a delegated assistant may change without account reauthorization. */
export const delegatedAccountPreferencesSchema = updateUserSettingsBodySchema
  .omit({
    superUserModeEnabled: true,
    mothershipEnvironment: true,
    copilotAutoAllowedTools: true,
    lastActiveWorkspaceId: true,
  })
  .strict()

function validatePreferenceInput(principal: Principal, input: UpdateAccountPreferencesInput) {
  const schema =
    principal.kind === 'session' ? updateUserSettingsBodySchema : delegatedAccountPreferencesSchema
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new OrchestrationError('validation', 'Unsupported or invalid account preferences')
  }
  return parsed.data
}

export const updateCurrentUserPreferences: OperationUseCase<
  typeof userAccountOperations.updateSettings,
  UpdateAccountPreferencesInput,
  { success: true }
> = {
  operation: userAccountOperations.updateSettings,
  async execute({ principal, input }) {
    const userId = await authorizeAccountPreferences(
      principal,
      userAccountOperations.updateSettings
    )
    const changes = validatePreferenceInput(principal, input)
    await db
      .insert(settings)
      .values({
        id: generateShortId(),
        userId,
        // A first narrow update must preserve the same defaults exposed before a row exists.
        ...defaultUserSettings,
        ...changes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [settings.userId],
        set: { ...changes, updatedAt: new Date() },
      })
    if ('superUserModeEnabled' in changes) invalidateSuperUserGate(userId)
    return { success: true }
  },
}

export const updateCurrentUserProfile: OperationUseCase<
  typeof userAccountOperations.updateProfile,
  UpdateUserProfileBody,
  UserProfileApiUser
> = {
  operation: userAccountOperations.updateProfile,
  async execute({ principal, input }) {
    const userId = await authorizeAccountPreferences(principal, userAccountOperations.updateProfile)
    const parsed = updateUserProfileBodySchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('validation', 'Invalid profile update')
    const [updated] = await db
      .update(user)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
    if (!updated) throw new OrchestrationError('not_found', 'User not found')
    return updated
  },
}
