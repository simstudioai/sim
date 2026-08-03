import { z } from 'zod'
import {
  MAX_SECRET_MOUNT_NAME_LENGTH,
  MAX_SECRET_MOUNT_NAMES,
} from '@/lib/copilot/secret-mount-policy'

export const secretMountScopeSchema = z.enum(['all', 'selected'])

export const mountedSecretNameSchema = z.string().trim().min(1).max(MAX_SECRET_MOUNT_NAME_LENGTH)

export const mountedSecretNamesSchema = z.array(mountedSecretNameSchema).max(MAX_SECRET_MOUNT_NAMES)

export const secretMountPolicySchema = z.object({
  secretScope: secretMountScopeSchema,
  mountedSecrets: mountedSecretNamesSchema,
})

export const secretMountPolicyInputSchema = secretMountPolicySchema.partial()

export type SecretMountPolicyInput = z.input<typeof secretMountPolicyInputSchema>
export type SecretMountPolicyOutput = z.output<typeof secretMountPolicySchema>
