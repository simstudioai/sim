import { env } from '@/lib/core/config/env'

export const MAX_ISOLATED_VM_BROKER_RESULT_JSON_CHARS =
  Number.parseInt(env.IVM_MAX_BROKER_RESULT_JSON_CHARS) || 16_777_216

export const MAX_SANDBOX_IMAGE_DATA_URI_CHARS = 8 * 1024 * 1024
