import { z } from 'zod'
import { codaIdSchema } from '@/connectors/coda/client'
import { parseMultiValue } from '@/connectors/utils'
import { codaPath } from '@/tools/coda/utils'

const configSchema = z.object({
  docIds: z.union([z.string(), z.array(z.string())]).optional(),
  organizationId: z.string().optional(),
})

export function codaSourceConfig(
  config: Record<string, unknown>,
  context?: Record<string, unknown>
) {
  const parsed = configSchema.parse(config)
  const docIds = z.array(codaIdSchema).max(100).parse(parseMultiValue(parsed.docIds))
  const organizationId =
    context?.mirrorsSourceAcls === true && parsed.organizationId?.trim()
      ? codaIdSchema.parse(parsed.organizationId.trim())
      : undefined
  return { docIds, organizationId }
}

export function codaOrganizationPath(
  organizationId: string,
  ...segments: Array<string | [string, string]>
) {
  return codaPath('organizations', [organizationId, 'organizationId'], ...segments)
}
