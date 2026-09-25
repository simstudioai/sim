import { z } from 'zod'
import {
  mountedSecretNamesSchema,
  secretMountScopeSchema,
} from '@/lib/api/contracts/secret-mount-policy'

export const inboxSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  username: z.string().min(1).max(64).optional(),
  secretScope: secretMountScopeSchema.optional(),
  mountedSecrets: mountedSecretNamesSchema.optional(),
})

export type InboxSettingsPatch = z.output<typeof inboxSettingsPatchSchema>
