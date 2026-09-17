import { z } from 'zod'
import { fetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { isRetryableError, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { ConnectorSourceError } from '@/connectors/source-error'
import { readBodyWithLimit } from '@/connectors/utils'
import { buildCodaUrl, codaHeaders } from '@/tools/coda/utils'

export const CODA_RESPONSE_BYTES = 4 * 1024 * 1024
export const codaIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,512}$/)
export const codaEmailSchema = z.string().email().max(254)
export const codaPageTokenSchema = z.string().min(1).max(4096)
const timestampSchema = z.string().datetime({ offset: true })
const sourceUrlSchema = z.string().url().max(4096)

export const codaDocSchema = z.object({
  id: codaIdSchema,
  name: z.string().max(4096),
  browserLink: sourceUrlSchema,
  updatedAt: timestampSchema.optional(),
  owner: codaEmailSchema.optional(),
  workspaceId: codaIdSchema.optional(),
  isDeleted: z.boolean().optional(),
  keyAccessRevoked: z.boolean().optional(),
})

export const codaAdminDocSchema = codaDocSchema.required({ workspaceId: true })

export const codaResourceSchema = z.object({
  id: codaIdSchema,
  name: z.string().max(4096),
  browserLink: sourceUrlSchema,
})

export const codaPageSchema = codaResourceSchema.extend({
  contentType: z.string(),
  isHidden: z.boolean(),
  isEffectivelyHidden: z.boolean(),
})

export const codaTableSchema = codaResourceSchema.extend({ tableType: z.string() })
export type CodaDoc = z.infer<typeof codaDocSchema>
export type CodaResource = z.infer<typeof codaResourceSchema>

export function codaListSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item).max(1000),
    nextPageToken: codaPageTokenSchema.optional(),
  })
}

/** Provider URLs are constructed locally; response links never receive the credential. */
export async function codaJson<T extends z.ZodType>(
  token: string,
  path: string,
  schema: T,
  query?: Record<string, string | number | boolean | undefined>,
  validating = false,
  admin = false
): Promise<z.output<T>> {
  const response = await fetchWithRetry(
    buildCodaUrl(path, query, admin ? 'admin' : 'public'),
    { headers: codaHeaders(token), redirect: 'error' },
    {
      ...(validating ? VALIDATE_RETRY_OPTIONS : {}),
      /** A newly created Coda doc returns 409 until its API snapshot is ready. */
      fetcher: async (input, init, transport) => {
        const response = await transport(input, init)
        if (response.status === 409) {
          await response.body?.cancel()
          throw new ConnectorSourceError(
            'Coda document is still initializing',
            409,
            'provider_unavailable'
          )
        }
        return response
      },
      retryCondition: (error) =>
        (error instanceof ConnectorSourceError && error.status === 409) || isRetryableError(error),
    }
  )
  if (!response.ok) {
    await response.body?.cancel()
    throw new ConnectorSourceError(
      `Coda request failed (${response.status})`,
      response.status,
      response.status === 401 || response.status === 403 ? 'authorization' : undefined
    )
  }
  const body = await readBodyWithLimit(response, CODA_RESPONSE_BYTES)
  if (!body) throw new Error('Coda response exceeded the 4MB limit')
  let data: unknown
  try {
    data = JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('Coda returned invalid JSON')
  }
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new Error('Coda returned an invalid response')
  return parsed.data
}

/** Drains bounded collections without retaining their response bodies or following nextPageLink. */
export async function* codaPages<T extends z.ZodType>(
  token: string,
  path: string,
  schema: T,
  query?: Record<string, string | number | boolean | undefined>,
  admin = false
) {
  let pageToken: string | undefined
  const seen = new Set<string>()
  for (let page = 0; page < 1000; page++) {
    const result = await codaJson(
      token,
      path,
      codaListSchema(schema),
      { limit: 100, ...query, pageToken },
      false,
      admin
    )
    yield result.items
    pageToken = result.nextPageToken
    if (!pageToken) return
    if (seen.has(pageToken)) throw new Error('Coda repeated a pagination token')
    seen.add(pageToken)
  }
  throw new Error('Coda exceeded the 1000-page safety limit')
}
