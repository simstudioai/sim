import { z } from 'zod'

/** Public operator-published metadata; never includes transport or credential configuration. */
export const gatewayPublicMetadataSchema = z.object({
  publicIps: z.array(z.ipv4()).max(16),
})
