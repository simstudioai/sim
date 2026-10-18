import { z } from 'zod'

const AZURE_INGESTION_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ingest\.monitor\.azure\.com$/
const AZURE_DIRECTORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const sentinelConfigSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          AZURE_INGESTION_HOST.test(url.hostname) &&
          !url.port &&
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    }, 'endpoint must be an Azure public-cloud HTTPS logs ingestion endpoint without a path, credentials, or query'),
  ruleId: z.string().regex(/^dcr-[0-9a-f]{32}$/i, 'ruleId must be the DCR immutable ID'),
  streamName: z
    .string()
    .min(8)
    .max(256)
    .regex(/^Custom-[A-Za-z0-9_-]+$/, 'streamName must be a Custom- stream declared in the DCR'),
  tenantId: z.string().regex(AZURE_DIRECTORY_ID, 'tenantId must be the Microsoft Entra tenant ID'),
  clientId: z.string().regex(AZURE_DIRECTORY_ID, 'clientId must be the application client ID'),
})

export const sentinelCredentialsSchema = z.object({
  clientSecret: z.string().min(1, 'clientSecret is required').max(4096),
})
