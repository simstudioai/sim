import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/** Published Concur token hosts, including server/client twins and implementation sandboxes. */
export const SAP_CONCUR_ALLOWED_DATACENTERS = new Set([
  'us.api.concursolutions.com',
  'www-us.api.concursolutions.com',
  'us2.api.concursolutions.com',
  'www-us2.api.concursolutions.com',
  'eu.api.concursolutions.com',
  'eu2.api.concursolutions.com',
  'www-eu2.api.concursolutions.com',
  'emea.api.concursolutions.com',
  'www-emea.api.concursolutions.com',
  'apj1.api.concursolutions.com',
  'www-apj1.api.concursolutions.com',
  'usg.api.concursolutions.com',
  'www-usg.api.concursolutions.com',
  'glz.api.concursolutions.com',
  'us-impl.api.concursolutions.com',
  'www-us-impl.api.concursolutions.com',
  'emea-impl.api.concursolutions.com',
  'www-emea-impl.api.concursolutions.com',
])

export const sapConcurDatacenterSchema = z
  .string()
  .min(1)
  .refine((datacenter) => SAP_CONCUR_ALLOWED_DATACENTERS.has(datacenter), {
    message: `datacenter must be one of: ${Array.from(SAP_CONCUR_ALLOWED_DATACENTERS).join(', ')}`,
  })

export const sapConcurGrantTypeSchema = z.enum(['client_credentials', 'password'])

export const sapConcurAuthSchema = z.object({
  datacenter: sapConcurDatacenterSchema.default('us.api.concursolutions.com'),
  grantType: sapConcurGrantTypeSchema.default('client_credentials'),
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
  username: z.string().optional(),
  password: z.string().optional(),
  companyUuid: z.string().optional(),
  credtype: z.enum(['password', 'authtoken']).optional(),
})

export type SapConcurAuth = z.infer<typeof sapConcurAuthSchema>

export const sapConcurHttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export const sapConcurApiPathSchema = z
  .string()
  .min(1, 'path is required')
  .refine(
    (path) =>
      !path.split(/[/\\]/).some((segment) => segment === '..' || segment === '.') &&
      !path.includes('#') &&
      !/%(?:2[eEfF]|5[cC]|23)/.test(path),
    {
      message:
        'path must not contain ".." or "." segments, "#", or percent-encoded path/fragment characters',
    }
  )

export const sapConcurApiInputSchema = sapConcurAuthSchema
  .extend({
    path: sapConcurApiPathSchema,
    method: sapConcurHttpMethodSchema.default('GET'),
    query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: z.unknown().optional(),
    contentType: z.string().optional(),
    accept: z.string().optional(),
  })
  .superRefine((input, context) => {
    if (input.grantType !== 'password') return
    if (!input.username && !input.companyUuid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['username'],
        message: 'username is required for password grant (or companyUuid for company-level auth)',
      })
    }
    if (!input.password) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'password is required for password grant',
      })
    }
  })

export type SapConcurApiInput = z.infer<typeof sapConcurApiInputSchema>

export const sapConcurUploadOperationSchema = z.enum([
  'upload_receipt_image',
  'create_quick_expense_with_image',
])

export const sapConcurUploadInputSchema = sapConcurAuthSchema.extend({
  operation: sapConcurUploadOperationSchema,
  userId: z.string().min(1, 'userId is required'),
  contextType: z.string().optional(),
  receipt: FileInputSchema,
  body: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
})

export type SapConcurUploadInput = z.infer<typeof sapConcurUploadInputSchema>
