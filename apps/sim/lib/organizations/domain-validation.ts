import { z } from 'zod'

export const MAX_ORGANIZATION_DOMAINS = 25
export const addOrganizationDomainBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required').max(253, 'Domain is too long'),
})
