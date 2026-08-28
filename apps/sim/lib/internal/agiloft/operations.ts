import { toError } from '@sim/utils/errors'
import { filterUndefined } from '@sim/utils/object'
import type {
  AgiloftAsyncStatusBody,
  AgiloftAttachBody,
  AgiloftAttachmentInfoBody,
  AgiloftCreateRecordBody,
  AgiloftDeleteRecordBody,
  AgiloftGetChoiceLineIdBody,
  AgiloftListTablesBody,
  AgiloftLockRecordBody,
  AgiloftNlpSearchBody,
  AgiloftReadRecordBody,
  AgiloftRemoveAttachmentBody,
  AgiloftRetrieveBody,
  AgiloftRunActionButtonBody,
  AgiloftSavedSearchBody,
  AgiloftSearchRecordsBody,
  AgiloftSelectRecordsBody,
  AgiloftUpdateRecordBody,
  AgiloftUpsertRecordBody,
} from '@/lib/api/contracts/tools/agiloft'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'
import {
  type AgiloftRequestConfig,
  executeAgiloftRequest,
  executeAlrestRequest,
  executeEwRequest,
  isAgiloftRefusal,
  readAlrestJson,
  resolveAgiloftInstance,
} from '@/lib/internal/agiloft/client'
import { AgiloftOperationError } from '@/lib/internal/agiloft/errors'
import { resolveAgiloftAttachmentFile } from '@/lib/internal/agiloft/file-input'
import { isEwRestBody, parseEwRest, toRecordIds } from '@/lib/internal/agiloft/protocol'
import {
  AGILOFT_ASYNC_STATUS,
  AGILOFT_LANG,
  AGILOFT_MAX_ATTACHMENT_BYTES,
  AGILOFT_MAX_SEARCH_RECORDS,
  AGILOFT_MAX_SELECT_IDS,
  alrestDeleteRecordUrl,
  alrestRecordCollectionUrl,
  alrestRecordUrl,
  alrestSearchUrl,
  buildAsyncStatusUrl,
  buildAttachFileUrl,
  buildAttachmentInfoUrl,
  buildGetChoiceLineIdUrl,
  buildListTablesUrl,
  buildLockRecordUrl,
  buildNlpSearchUrl,
  buildRemoveAttachmentUrl,
  buildRetrieveAttachmentUrl,
  buildRunActionButtonUrl,
  buildSavedSearchUrl,
  buildSelectRecordsUrl,
  buildUpsertRecordBody,
  buildUpsertRecordUrl,
  describeAgiloftError,
  ewCredentialBody,
  getLockHttpMethod,
  parseFieldList,
} from '@/lib/internal/agiloft/urls'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import type {
  AgiloftAsyncStatusResponse,
  AgiloftAttachmentInfoResponse,
  AgiloftDeleteResponse,
  AgiloftGetChoiceLineIdResponse,
  AgiloftListTablesResponse,
  AgiloftLockResponse,
  AgiloftNlpSearchResponse,
  AgiloftRecordResponse,
  AgiloftRemoveAttachmentResponse,
  AgiloftRunActionButtonResponse,
  AgiloftSavedSearchResponse,
  AgiloftSearchResponse,
  AgiloftSelectResponse,
  AgiloftTableField,
  AgiloftUpsertRecordResponse,
} from '@/tools/agiloft/types'
import type { ToolResponse } from '@/tools/types'

export interface AgiloftOperationContext {
  requestId: string
  userId?: string
  signal?: AbortSignal
}

function parseRecordData(data: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(data)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function preserveRefusal<R extends ToolResponse>(
  run: () => Promise<R>,
  output: R['output']
): Promise<R> {
  try {
    return await run()
  } catch (error) {
    if (!isAgiloftRefusal(error)) throw error
    return { success: false, output, error: error.message } as R
  }
}

export async function executeAgiloftCreateRecord(
  input: AgiloftCreateRecordBody,
  context: AgiloftOperationContext
): Promise<AgiloftRecordResponse> {
  const fields = parseRecordData(input.data)
  if (!fields) {
    return {
      success: false,
      output: { id: null, fields: {} },
      error: 'The data parameter must be a JSON object of field names to values',
    }
  }
  return preserveRefusal(
    () =>
      executeAlrestRequest<AgiloftRecordResponse>(
        input,
        (base) => ({
          url: alrestRecordCollectionUrl(base, input.table),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
        }),
        async (response) => {
          const record = await readAlrestJson<Record<string, unknown>>(response)
          const id = record?.id
          return id == null
            ? {
                success: false,
                output: { id: null, fields: record ?? {} },
                error: 'Agiloft did not return an ID for the created record',
              }
            : { success: true, output: { id: String(id), fields: record ?? {} } }
        },
        context.signal
      ),
    { id: null, fields: {} }
  )
}

export async function executeAgiloftReadRecord(
  input: AgiloftReadRecordBody,
  context: AgiloftOperationContext
): Promise<AgiloftRecordResponse> {
  const requestedFields = parseFieldList(input.fields)
  const recordId = input.recordId.trim()
  if (requestedFields && !/^\d+$/.test(recordId)) {
    return {
      success: false,
      output: { id: null, fields: {} },
      error: `Record ID must be numeric to read specific fields, got "${recordId}"`,
    }
  }
  return preserveRefusal(
    () =>
      executeAlrestRequest<AgiloftRecordResponse>(
        input,
        (base): AgiloftRequestConfig =>
          requestedFields
            ? {
                url: alrestSearchUrl(base, input.table),
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                  field: requestedFields.includes('id')
                    ? requestedFields
                    : ['id', ...requestedFields],
                  query: `id=${recordId}`,
                }),
              }
            : {
                url: alrestRecordUrl(base, input.table, input.recordId),
                method: 'GET',
                headers: { Accept: 'application/json' },
              },
        async (response) => {
          const payload = await readAlrestJson<Record<string, unknown> | Record<string, unknown>[]>(
            response
          )
          const record = Array.isArray(payload)
            ? payload.find((row) => {
                const rowId = String(row?.id ?? '')
                return /^\d+$/.test(rowId) && BigInt(rowId) === BigInt(recordId)
              })
            : payload
          if (!record) {
            return {
              success: false,
              output: { id: null, fields: {} },
              error: `Agiloft returned no record for ID ${recordId}`,
            }
          }
          return {
            success: true,
            output: { id: record.id == null ? null : String(record.id), fields: record },
          }
        },
        context.signal
      ),
    { id: null, fields: {} }
  )
}

export async function executeAgiloftUpdateRecord(
  input: AgiloftUpdateRecordBody,
  context: AgiloftOperationContext
): Promise<AgiloftRecordResponse> {
  const fields = parseRecordData(input.data)
  if (!fields) {
    return {
      success: false,
      output: { id: null, fields: {} },
      error: 'The data parameter must be a JSON object of field names to values',
    }
  }
  return preserveRefusal(
    () =>
      executeAlrestRequest<AgiloftRecordResponse>(
        input,
        (base) => ({
          url: alrestRecordUrl(base, input.table, input.recordId),
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
        }),
        async (response) => {
          const record = await readAlrestJson<Record<string, unknown>>(response)
          return {
            success: true,
            output: {
              id: String(record?.id ?? input.recordId.trim()),
              fields: record ?? {},
            },
          }
        },
        context.signal
      ),
    { id: null, fields: {} }
  )
}

export async function executeAgiloftDeleteRecord(
  input: AgiloftDeleteRecordBody,
  context: AgiloftOperationContext
): Promise<AgiloftDeleteResponse> {
  return preserveRefusal(
    () =>
      executeAlrestRequest<AgiloftDeleteResponse>(
        input,
        (base) => ({
          url: alrestDeleteRecordUrl(
            base,
            input.table,
            input.recordId,
            input.deleteRule,
            input.substituteIds
          ),
          method: 'DELETE',
          headers: { Accept: 'application/json' },
        }),
        async (response) => {
          await readAlrestJson<unknown>(response)
          return {
            success: true,
            output: { id: input.recordId.trim(), deleted: true },
          }
        },
        context.signal
      ),
    { id: '', deleted: false }
  )
}

export async function executeAgiloftSearchRecords(
  input: AgiloftSearchRecordsBody,
  context: AgiloftOperationContext
): Promise<AgiloftSearchResponse> {
  const page = input.page ? Number(input.page) : 0
  const limit = input.limit ? Number(input.limit) : 0
  return preserveRefusal(
    () =>
      executeAlrestRequest<AgiloftSearchResponse>(
        input,
        (base) => ({
          url: alrestSearchUrl(base, input.table),
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(
            filterUndefined({
              search: input.search?.trim() || undefined,
              query: input.query?.trim() || undefined,
              field: parseFieldList(input.fields),
              page: input.page ? page : undefined,
              limit: input.limit ? limit : undefined,
            })
          ),
        }),
        async (response) => {
          const returned = (await readAlrestJson<Record<string, unknown>[]>(response)) ?? []
          const records = returned.slice(0, AGILOFT_MAX_SEARCH_RECORDS)
          return {
            success: true,
            output: {
              records,
              totalCount: records.length,
              page,
              limit,
              truncated: returned.length > records.length,
            },
          }
        },
        context.signal
      ),
    { records: [], totalCount: 0, page: 0, limit: 0, truncated: false }
  )
}

export async function executeAgiloftSelectRecords(
  input: AgiloftSelectRecordsBody,
  context: AgiloftOperationContext
): Promise<AgiloftSelectResponse> {
  return executeEwRequest<AgiloftSelectResponse>(
    input,
    (base) => ({
      url: buildSelectRecordsUrl(base, input),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: ewCredentialBody(input),
    }),
    async (response) => {
      const body = await response.text()
      if (!response.ok) {
        return {
          success: false,
          output: { recordIds: [], totalCount: 0, truncated: false },
          error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
        }
      }
      const values = parseEwRest(body)
      if (values.size === 0) {
        return {
          success: false,
          output: { recordIds: [], totalCount: 0, truncated: false },
          error: `Agiloft did not return a result set: ${body.trim() || '(empty response)'}`,
        }
      }
      const recordIds = toRecordIds(values).recordIds
      const capped = recordIds.slice(0, AGILOFT_MAX_SELECT_IDS)
      return {
        success: true,
        output: {
          recordIds: capped,
          totalCount: capped.length,
          truncated: recordIds.length > capped.length,
        },
      }
    },
    context.signal
  )
}

function emptyLock(recordId: string) {
  return {
    id: recordId.trim(),
    tableId: null,
    lockStatus: '',
    lockedBy: null,
    lockExpiresInMinutes: null,
  }
}

export async function executeAgiloftAttachmentInfo(
  input: AgiloftAttachmentInfoBody,
  context: AgiloftOperationContext
): Promise<AgiloftAttachmentInfoResponse> {
  return executeEwRequest<AgiloftAttachmentInfoResponse>(
    input,
    (base) => ({ url: buildAttachmentInfoUrl(base, input), method: 'GET' }),
    async (response) => {
      if (!response.ok) {
        const text = await response.text()
        return {
          success: false,
          output: { attachments: [], totalCount: 0 },
          error: `Agiloft error ${response.status}: ${describeAgiloftError(text)}`,
        }
      }
      const data = (await response.json()) as Record<string, unknown>
      const payload = (data.result ?? data) as Record<string, unknown>
      const attachments: Array<{ position: number; name: string; size: number }> = []
      if (Array.isArray(payload)) {
        for (let index = 0; index < payload.length; index++) {
          const item = payload[index] as Record<string, unknown>
          attachments.push({
            position: (item.filePosition as number) ?? (item.position as number) ?? index,
            name:
              (item.fileName as string) ?? (item.name as string) ?? (item.filename as string) ?? '',
            size: (item.size as number) ?? (item.fileSize as number) ?? 0,
          })
        }
      }
      return {
        success: data.success !== false,
        output: { attachments, totalCount: attachments.length },
      }
    },
    context.signal
  )
}

export async function executeAgiloftLockRecord(
  input: AgiloftLockRecordBody,
  context: AgiloftOperationContext
): Promise<AgiloftLockResponse> {
  return executeEwRequest<AgiloftLockResponse>(
    input,
    (base) => ({
      url: buildLockRecordUrl(base, input),
      method: getLockHttpMethod(input.lockAction),
    }),
    async (response) => {
      if (!response.ok) {
        const text = await response.text()
        return {
          success: false,
          output: emptyLock(input.recordId),
          error: `Agiloft error ${response.status}: ${describeAgiloftError(text)}`,
        }
      }
      const data = (await response.json()) as Record<string, unknown>
      if (typeof data.lock_status !== 'string') {
        const code = typeof data.error === 'string' ? data.error : 'UNKNOWN'
        const detail =
          typeof data.error_description === 'string' ? data.error_description : JSON.stringify(data)
        return {
          success: false,
          output: emptyLock(input.recordId),
          error: `Agiloft lock error (${code}): ${detail}`,
        }
      }
      return {
        success: true,
        output: {
          id: String(data.id ?? input.recordId.trim()),
          tableId: typeof data.table_id === 'number' ? data.table_id : null,
          lockStatus: data.lock_status,
          lockedBy: typeof data.locked_by === 'string' ? data.locked_by : null,
          lockExpiresInMinutes:
            typeof data.lock_expires_in_minutes === 'number' ? data.lock_expires_in_minutes : null,
        },
      }
    },
    context.signal
  )
}

export async function executeAgiloftRemoveAttachment(
  input: AgiloftRemoveAttachmentBody,
  context: AgiloftOperationContext
): Promise<AgiloftRemoveAttachmentResponse> {
  return executeEwRequest<AgiloftRemoveAttachmentResponse>(
    input,
    (base) => ({ url: buildRemoveAttachmentUrl(base, input), method: 'GET' }),
    async (response) => {
      const text = await response.text()
      const fieldName = input.fieldName.trim()
      if (!response.ok) {
        return {
          success: false,
          output: { recordId: input.recordId.trim(), fieldName, remainingAttachments: 0 },
          error: `Agiloft error ${response.status}: ${describeAgiloftError(text)}`,
        }
      }
      const values = parseEwRest(text)
      const remainingAttachments = Number(
        values.get(`${fieldName}.length`) ?? [...values.values()][0]
      )
      if (!Number.isFinite(remainingAttachments)) {
        return {
          success: false,
          output: { recordId: input.recordId.trim(), fieldName, remainingAttachments: 0 },
          error: `Agiloft did not report the remaining attachment count: ${text.trim() || '(empty response)'}`,
        }
      }
      return {
        success: true,
        output: { recordId: input.recordId.trim(), fieldName, remainingAttachments },
      }
    },
    context.signal
  )
}

export async function executeAgiloftGetChoiceLineId(
  input: AgiloftGetChoiceLineIdBody,
  context: AgiloftOperationContext
): Promise<AgiloftGetChoiceLineIdResponse> {
  return executeEwRequest<AgiloftGetChoiceLineIdResponse>(
    input,
    (base) => ({ url: buildGetChoiceLineIdUrl(base, input), method: 'GET' }),
    async (response) => {
      const body = await response.text()
      if (!response.ok) {
        return {
          success: false,
          output: { choiceLineId: null },
          error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
        }
      }
      const raw = parseEwRest(body).get('choiceLineId')
      const id = Number(raw)
      if (raw === undefined) {
        return {
          success: false,
          output: { choiceLineId: null },
          error: `Agiloft did not return a choice line ID for "${input.value}" in field "${input.fieldName}": ${body.trim() || '(empty response)'}`,
        }
      }
      if (raw.trim() === '' || !Number.isFinite(id)) {
        return {
          success: false,
          output: { choiceLineId: null },
          error: `Agiloft returned a non-numeric choice line ID for "${input.value}" in field "${input.fieldName}": "${raw}"`,
        }
      }
      return { success: true, output: { choiceLineId: id } }
    },
    context.signal
  )
}

export async function executeAgiloftRunActionButton(
  input: AgiloftRunActionButtonBody,
  context: AgiloftOperationContext
): Promise<AgiloftRunActionButtonResponse> {
  return executeEwRequest<AgiloftRunActionButtonResponse>(
    input,
    (base) => ({
      url: buildRunActionButtonUrl(base, input),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
    async (response) => {
      const body = await response.text()
      const recordId = input.recordId.trim()
      if (!response.ok) {
        return {
          success: false,
          output: { recordId, callbackId: null },
          error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
        }
      }
      const values = parseEwRest(body)
      if (values.size === 0) {
        return {
          success: false,
          output: { recordId, callbackId: null },
          error: `Agiloft did not acknowledge the action button: ${body.trim() || '(empty response)'}`,
        }
      }
      return {
        success: true,
        output: {
          recordId: values.get('id') ?? recordId,
          callbackId: values.get('EWCALLBACK_ID') ?? null,
        },
      }
    },
    context.signal
  )
}

export async function executeAgiloftAsyncStatus(
  input: AgiloftAsyncStatusBody,
  context: AgiloftOperationContext
): Promise<AgiloftAsyncStatusResponse> {
  return executeEwRequest<AgiloftAsyncStatusResponse>(
    input,
    (base) => ({ url: buildAsyncStatusUrl(base, input), method: 'GET' }),
    async (response) => {
      const known = AGILOFT_ASYNC_STATUS[response.status]
      if (!known) {
        const body = await response.text()
        return {
          success: false,
          output: {
            callbackId: input.callbackId.trim(),
            statusCode: response.status,
            status: 'unrecognized',
            complete: false,
          },
          error: `Agiloft returned an unrecognized async status ${response.status}: ${body.trim() || '(empty response)'}`,
        }
      }
      return {
        success: true,
        output: {
          callbackId: input.callbackId.trim(),
          statusCode: response.status,
          status: known.status,
          complete: known.complete,
        },
      }
    },
    context.signal
  )
}

export async function executeAgiloftSavedSearch(
  input: AgiloftSavedSearchBody,
  context: AgiloftOperationContext
): Promise<AgiloftSavedSearchResponse> {
  return preserveRefusal(
    () =>
      executeAgiloftRequest<AgiloftSavedSearchResponse>(
        input,
        (base) => ({
          url: buildSavedSearchUrl(base, input),
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        async (response) => {
          const rows =
            (await readAlrestJson<
              Array<{ name?: string; label?: string; id?: number; description?: string }>
            >(response)) ?? []
          const searches = rows.map((row) => ({
            name: row.name ?? '',
            label: row.label ?? row.name ?? '',
            id: row.id ?? null,
            description: row.description ?? null,
          }))
          return { success: true, output: { searches, totalCount: searches.length } }
        },
        context.signal
      ),
    { searches: [], totalCount: 0 }
  )
}

interface EwTableResult {
  tables?: Array<{
    label?: string
    logicalName?: string
    fields?: Array<{
      columnName?: string
      columnLabel?: string
      columnType?: string
      columnTypeDomain?: string
      required?: boolean
      isLinked?: boolean
      linkedInfo?: Array<{ linkedTable?: string; linkedColumn?: string }>
      textFieldType?: string
    }>
  }>
}

export async function executeAgiloftListTables(
  input: AgiloftListTablesBody,
  context: AgiloftOperationContext
): Promise<AgiloftListTablesResponse> {
  try {
    return await executeAgiloftRequest<AgiloftListTablesResponse>(
      input,
      (base) => ({
        url: buildListTablesUrl(base, input),
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      async (response) => {
        const payload = await readAlrestJson<EwTableResult>(response)
        const tables = (payload?.tables ?? []).map((table) => ({
          label: table.label ?? '',
          logicalName: table.logicalName ?? '',
          fields: (table.fields ?? []).map(
            (field): AgiloftTableField => ({
              columnName: field.columnName ?? '',
              columnLabel: field.columnLabel ?? '',
              columnType: field.columnType ?? '',
              columnTypeDomain: field.columnTypeDomain ?? '',
              required: field.required === true,
              isLinked: field.isLinked === true,
              linkedInfo: (field.linkedInfo ?? []).map((link) => ({
                linkedTable: link.linkedTable ?? '',
                linkedColumn: link.linkedColumn ?? '',
              })),
              textFieldType: field.textFieldType ?? null,
            })
          ),
        }))
        return { success: true, output: { tables, totalCount: tables.length } }
      },
      context.signal
    )
  } catch (error) {
    if (!input.table && /\$table/.test(toError(error).message)) {
      return {
        success: false,
        output: { tables: [], totalCount: 0 },
        error:
          'This Agiloft instance requires a table name to authenticate. Put any known table in the Table field — it also narrows the result to that table.',
      }
    }
    if (!isAgiloftRefusal(error)) throw error
    return {
      success: false,
      output: { tables: [], totalCount: 0 },
      error: error.message,
    }
  }
}

export async function executeAgiloftNlpSearch(
  input: AgiloftNlpSearchBody,
  context: AgiloftOperationContext
): Promise<AgiloftNlpSearchResponse> {
  return executeEwRequest<AgiloftNlpSearchResponse>(
    input,
    (base) => ({
      url: buildNlpSearchUrl(base),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        filterUndefined({
          $KB: input.knowledgeBase,
          $login: input.login,
          $password: input.password,
          $lang: AGILOFT_LANG,
          field: parseFieldList(input.fields),
          nlp_query: input.nlpQuery.trim(),
          page: input.page ? Number(input.page) : undefined,
          limit: input.limit ? Number(input.limit) : undefined,
        })
      ),
    }),
    async (response) => {
      const returned = (await readAlrestJson<Record<string, unknown>[]>(response)) ?? []
      const records = returned.slice(0, AGILOFT_MAX_SEARCH_RECORDS)
      return {
        success: true,
        output: {
          records,
          totalCount: records.length,
          truncated: returned.length > records.length,
        },
      }
    },
    context.signal
  )
}

export async function executeAgiloftUpsertRecord(
  input: AgiloftUpsertRecordBody,
  context: AgiloftOperationContext
): Promise<AgiloftUpsertRecordResponse> {
  const fields = parseRecordData(input.data)
  if (!fields) {
    return {
      success: false,
      output: { id: null, created: false, callbackId: null },
      error: 'The data parameter must be a JSON object of field names to values',
    }
  }
  let encoded: string
  try {
    encoded = buildUpsertRecordBody(input, fields)
  } catch (error) {
    return {
      success: false,
      output: { id: null, created: false, callbackId: null },
      error: toError(error).message,
    }
  }
  return executeEwRequest<AgiloftUpsertRecordResponse>(
    input,
    (base) => ({
      url: buildUpsertRecordUrl(base),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encoded,
    }),
    async (response) => {
      const body = await response.text()
      if (response.status === 409) {
        return {
          success: false,
          output: { id: null, created: false, callbackId: null },
          error: `Agiloft found more than one record matching "${input.match}", so it did not write: ${body.trim()}`,
        }
      }
      if (!response.ok) {
        return {
          success: false,
          output: { id: null, created: false, callbackId: null },
          error: `Agiloft error ${response.status}: ${describeAgiloftError(body)}`,
        }
      }
      if (response.status === 202) {
        return {
          success: true,
          output: {
            id: null,
            created: false,
            callbackId: parseEwRest(body).get('EWCALLBACK_ID') ?? null,
          },
        }
      }
      const id = parseEwRest(body).get('id')
      return id === undefined
        ? {
            success: false,
            output: { id: null, created: false, callbackId: null },
            error: `Agiloft did not return a record ID: ${body.trim() || '(empty response)'}`,
          }
        : {
            success: true,
            output: { id, created: response.status === 201, callbackId: null },
          }
    },
    context.signal
  )
}

export async function executeAgiloftAttachFile(
  input: AgiloftAttachBody,
  context: AgiloftOperationContext
): Promise<ToolResponse> {
  const { userFile, buffer } = await resolveAgiloftAttachmentFile(input.file, context)
  const fileName = input.fileName || userFile.name || 'attachment'
  let resolvedIP: string
  try {
    resolvedIP = await resolveAgiloftInstance(input.instanceUrl, context.signal)
  } catch (error) {
    context.signal?.throwIfAborted()
    throw new AgiloftOperationError(400, { success: false, error: toError(error).message })
  }
  const response = await secureFetchWithPinnedIP(
    buildAttachFileUrl(input.instanceUrl.replace(/\/$/, ''), input, fileName),
    resolvedIP,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal: context.signal,
    }
  )
  const text = await response.text()
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new AgiloftOperationError(response.status, {
      success: false,
      error: `Agiloft error ${response.status}: ${describeAgiloftError(text)}`,
    })
  }
  const values = parseEwRest(text)
  const totalAttachments = Number(
    values.get(`${input.fieldName.trim()}.length`) ?? [...values.values()][0]
  )
  if (!Number.isFinite(totalAttachments)) {
    throw new AgiloftOperationError(502, {
      success: false,
      error: `Agiloft did not confirm the attachment: ${describeAgiloftError(text) || '(empty response)'}`,
    })
  }
  return {
    success: true,
    output: {
      recordId: input.recordId.trim(),
      fieldName: input.fieldName.trim(),
      fileName,
      totalAttachments,
    },
  }
}

export async function executeAgiloftRetrieveAttachment(
  input: AgiloftRetrieveBody,
  context: AgiloftOperationContext
): Promise<ToolResponse> {
  let resolvedIP: string
  try {
    resolvedIP = await resolveAgiloftInstance(input.instanceUrl, context.signal)
  } catch (error) {
    context.signal?.throwIfAborted()
    throw new AgiloftOperationError(400, { success: false, error: toError(error).message })
  }
  const response = await secureFetchWithPinnedIP(
    buildRetrieveAttachmentUrl(input.instanceUrl.replace(/\/$/, ''), input),
    resolvedIP,
    { method: 'GET', maxResponseBytes: AGILOFT_MAX_ATTACHMENT_BYTES, signal: context.signal }
  )
  if (!response.ok) {
    const text = await response.text()
    throw new AgiloftOperationError(response.status, {
      success: false,
      error: `Agiloft error ${response.status}: ${describeAgiloftError(text)}`,
    })
  }
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const disposition = response.headers.get('content-disposition')
  const match = disposition?.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
  const fileName = match?.[1] ? match[1].replace(/['"]/g, '') : 'attachment'
  const buffer = Buffer.from(await response.arrayBuffer())
  context.signal?.throwIfAborted()
  if (isEwRestBody(buffer.subarray(0, 512).toString('utf8'))) {
    throw new AgiloftOperationError(502, {
      success: false,
      error: `Agiloft error: ${buffer.toString('utf8').slice(0, 300)}`,
    })
  }
  return {
    success: true,
    output: {
      file: {
        name: fileName,
        mimeType: resolveEffectiveMimeType(contentType, fileName),
        data: buffer.toString('base64'),
        size: buffer.length,
      },
    },
  }
}
