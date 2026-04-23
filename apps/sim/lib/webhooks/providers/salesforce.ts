import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'

export function extractSalesforceObjectTypeFromPayload(
  body: Record<string, unknown>
): string | undefined {
  const direct =
    (typeof body.objectType === 'string' && body.objectType) ||
    (typeof body.sobjectType === 'string' && body.sobjectType) ||
    undefined
  if (direct) {
    return direct
  }

  const attrs = body.attributes as Record<string, unknown> | undefined
  if (typeof attrs?.type === 'string') {
    return attrs.type
  }

  const record = body.record
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    const r = record as Record<string, unknown>
    if (typeof r.sobjectType === 'string') {
      return r.sobjectType
    }
    const ra = r.attributes as Record<string, unknown> | undefined
    if (typeof ra?.type === 'string') {
      return ra.type
    }
  }

  return undefined
}

const logger = createLogger('WebhookProvider:Salesforce')

function verifySalesforceSharedSecret(request: Request, secret: string): boolean {
  if (verifyTokenAuth(request, secret, 'x-sim-webhook-secret')) {
    return true
  }
  return verifyTokenAuth(request, secret)
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function extractRecordCore(body: Record<string, unknown>): Record<string, unknown> {
  const nested = body.record
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>) }
  }

  const skip = new Set([
    'eventType',
    'simEventType',
    'changedFields',
    'previousStage',
    'newStage',
    'previousStatus',
    'newStatus',
    'payload',
    'record',
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (!skip.has(k)) {
      out[k] = v
    }
  }
  return out
}

function pickTimestamp(body: Record<string, unknown>, record: Record<string, unknown>): string {
  const candidates = [
    body.timestamp,
    body.time,
    record.SystemModstamp,
    record.LastModifiedDate,
    record.CreatedDate,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) {
      return c
    }
  }
  return ''
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function buildFallbackDeliveryFingerprint(body: Record<string, unknown>): string {
  return sha256Hex(stableSerialize(body))
}

function pickRecordId(body: Record<string, unknown>, record: Record<string, unknown>): string {
  const id =
    (typeof body.recordId === 'string' && body.recordId) ||
    (typeof record.Id === 'string' && record.Id) ||
    (typeof body.Id === 'string' && body.Id) ||
    ''
  return id
}

function pickStr(record: Record<string, unknown>, key: string): string {
  const v = record[key]
  return typeof v === 'string' ? v : ''
}

export const salesforceHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret?.trim()) {
      logger.warn(`[${requestId}] Salesforce webhook missing webhookSecret — rejecting`)
      return new NextResponse('Unauthorized - Webhook secret not configured', { status: 401 })
    }

    if (!verifySalesforceSharedSecret(request, secret.trim())) {
      logger.warn(`[${requestId}] Salesforce webhook secret verification failed`)
      return new NextResponse('Unauthorized - Invalid webhook secret', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) {
      return true
    }

    const { isSalesforceEventMatch } = await import('@/triggers/salesforce/utils')
    const configuredObjectType = providerConfig.objectType as string | undefined
    const obj = asRecord(body)

    if (!isSalesforceEventMatch(triggerId, obj, configuredObjectType)) {
      logger.debug(
        `[${requestId}] Salesforce event mismatch for trigger ${triggerId}. Skipping execution.`,
        { webhookId: webhook.id, workflowId: workflow.id, triggerId }
      )
      return false
    }

    return true
  },

  async formatInput(ctx: FormatInputContext): Promise<FormatInputResult> {
    const rawPc = (ctx.webhook as { providerConfig?: unknown }).providerConfig
    const pc =
      rawPc && typeof rawPc === 'object' && !Array.isArray(rawPc)
        ? (rawPc as Record<string, unknown>)
        : {}
    const id = typeof pc.triggerId === 'string' ? pc.triggerId : ''
    const body = asRecord(ctx.body)

    const record = extractRecordCore(body)
    const objectType =
      extractSalesforceObjectTypeFromPayload(body) ||
      (typeof record.attributes === 'object' &&
      record.attributes &&
      typeof (record.attributes as Record<string, unknown>).type === 'string'
        ? String((record.attributes as Record<string, unknown>).type)
        : '') ||
      (typeof record.sobjectType === 'string' ? record.sobjectType : '')
    const recordId = pickRecordId(body, record)
    const timestamp = pickTimestamp(body, record)
    const eventTypeRaw =
      (typeof body.eventType === 'string' && body.eventType) ||
      (typeof body.simEventType === 'string' && body.simEventType) ||
      ''
    const simEventTypeRaw = typeof body.simEventType === 'string' ? body.simEventType : ''

    if (id === 'salesforce_webhook') {
      return {
        input: {
          eventType: eventTypeRaw || 'webhook',
          objectType: objectType || '',
          recordId,
          timestamp,
          simEventType: simEventTypeRaw,
          record: Object.keys(record).length > 0 ? record : body,
          payload: ctx.body,
        },
      }
    }

    if (
      id === 'salesforce_record_created' ||
      id === 'salesforce_record_updated' ||
      id === 'salesforce_record_deleted'
    ) {
      const changedFields = body.changedFields
      return {
        input: {
          eventType: eventTypeRaw || id.replace('salesforce_', '').replace(/_/g, ' '),
          objectType: objectType || '',
          recordId,
          timestamp,
          simEventType: simEventTypeRaw,
          record: {
            Id: typeof record.Id === 'string' ? record.Id : recordId,
            Name: typeof record.Name === 'string' ? record.Name : '',
            CreatedDate: typeof record.CreatedDate === 'string' ? record.CreatedDate : '',
            LastModifiedDate:
              typeof record.LastModifiedDate === 'string' ? record.LastModifiedDate : '',
            OwnerId: pickStr(record, 'OwnerId'),
            SystemModstamp: pickStr(record, 'SystemModstamp'),
          },
          changedFields: changedFields !== undefined ? changedFields : null,
          payload: ctx.body,
        },
      }
    }

    if (id === 'salesforce_opportunity_stage_changed') {
      return {
        input: {
          eventType: eventTypeRaw || 'opportunity_stage_changed',
          objectType: objectType || 'Opportunity',
          recordId,
          timestamp,
          simEventType: simEventTypeRaw,
          record: {
            Id: typeof record.Id === 'string' ? record.Id : recordId,
            Name: typeof record.Name === 'string' ? record.Name : '',
            StageName: typeof record.StageName === 'string' ? record.StageName : '',
            Amount: record.Amount !== undefined ? String(record.Amount) : '',
            CloseDate: typeof record.CloseDate === 'string' ? record.CloseDate : '',
            Probability: record.Probability !== undefined ? String(record.Probability) : '',
            AccountId: pickStr(record, 'AccountId'),
            OwnerId: pickStr(record, 'OwnerId'),
          },
          previousStage:
            typeof body.previousStage === 'string'
              ? body.previousStage
              : typeof body.PriorStage === 'string'
                ? body.PriorStage
                : '',
          newStage:
            typeof body.newStage === 'string'
              ? body.newStage
              : typeof record.StageName === 'string'
                ? record.StageName
                : '',
          payload: ctx.body,
        },
      }
    }

    if (id === 'salesforce_case_status_changed') {
      return {
        input: {
          eventType: eventTypeRaw || 'case_status_changed',
          objectType: objectType || 'Case',
          recordId,
          timestamp,
          simEventType: simEventTypeRaw,
          record: {
            Id: typeof record.Id === 'string' ? record.Id : recordId,
            Subject: typeof record.Subject === 'string' ? record.Subject : '',
            Status: typeof record.Status === 'string' ? record.Status : '',
            Priority: typeof record.Priority === 'string' ? record.Priority : '',
            CaseNumber: typeof record.CaseNumber === 'string' ? record.CaseNumber : '',
            AccountId: pickStr(record, 'AccountId'),
            ContactId: pickStr(record, 'ContactId'),
            OwnerId: pickStr(record, 'OwnerId'),
          },
          previousStatus:
            typeof body.previousStatus === 'string'
              ? body.previousStatus
              : typeof body.PriorStatus === 'string'
                ? body.PriorStatus
                : '',
          newStatus:
            typeof body.newStatus === 'string'
              ? body.newStatus
              : typeof record.Status === 'string'
                ? record.Status
                : '',
          payload: ctx.body,
        },
      }
    }

    return {
      input: {
        eventType: eventTypeRaw || 'webhook',
        objectType: objectType || '',
        recordId,
        timestamp,
        simEventType: simEventTypeRaw,
        record: Object.keys(record).length > 0 ? record : body,
        payload: ctx.body,
      },
    }
  },

  extractIdempotencyId(body: unknown): string | null {
    const b = asRecord(body)
    const record = extractRecordCore(b)
    const id = pickRecordId(b, record)
    const et =
      (typeof b.eventType === 'string' && b.eventType) ||
      (typeof b.simEventType === 'string' && b.simEventType) ||
      ''
    const ts = pickTimestamp(b, record)
    if (!id) {
      return null
    }
    if (ts) {
      return `salesforce:${et || 'event'}:${id}:${ts}`
    }

    return `salesforce:${et || 'event'}:${id}:${buildFallbackDeliveryFingerprint(b)}`
  },
}
