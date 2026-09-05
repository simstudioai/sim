import { z } from 'zod'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { downloadNarrativeOutput } from '@/lib/internal/oracle-epm-narrative-reporting/operations/files'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import {
  type NarrativeDownloadInput,
  type NarrativeListInput,
  type NarrativeResourceInput,
  narrativeBookSchema,
  narrativePageSchema,
  narrativePovSchema,
  parseNarrativeJson,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const FIELDS =
  'bookId,name,description,createdBy,creationDate,modifiedDate,lastAccessed,pathName,systemPath,datasourceNames,validationMessages'

export async function listBooks(input: NarrativeListInput, context: NarrativeOperationContext) {
  const response = await context.client.request(narrativeEndpoints.listBooks, {
    query: {
      fields: FIELDS,
      limit: input.limit,
      offset: input.offset,
      q: input.q,
      orderBy: input.orderBy,
    },
    signal: context.signal,
  })
  const { items, ...page } = parseNarrativeJson(narrativePageSchema(narrativeBookSchema), response)
  return { success: true, output: { books: items, ...page } }
}

export async function getBook(input: NarrativeResourceInput, context: NarrativeOperationContext) {
  const response = await context.client.request(narrativeEndpoints.getBook, {
    pathParams: { id: input.resourceId },
    query: { fields: FIELDS },
    signal: context.signal,
  })
  return { success: true, output: { book: parseNarrativeJson(narrativeBookSchema, response) } }
}

export async function getBookGlobalPov(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.getBookPov, {
    pathParams: { id: input.resourceId },
    signal: context.signal,
  })
  return {
    success: true,
    output: { dimensions: parseNarrativeJson(z.array(narrativePovSchema).max(100), response) },
  }
}

export async function downloadBookOutput(
  input: NarrativeDownloadInput,
  context: NarrativeOperationContext
) {
  return downloadNarrativeOutput(
    context,
    narrativeEndpoints.downloadBook,
    input,
    {
      format: input.format,
      globalPov: input.globalPov,
    },
    [
      input.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
    ]
  )
}
