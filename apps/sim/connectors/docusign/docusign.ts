import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { DocuSignIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('DocuSignConnector')

/**
 * DocuSign OAuth userinfo endpoint. Sim's DocuSign OAuth integration is wired to the
 * demo/sandbox authorization server (`account-d.docusign.com`, see lib/oauth/oauth.ts token
 * endpoint), so the connector resolves account info from the matching demo userinfo host.
 * The production host is `https://account.docusign.com/oauth/userinfo`.
 */
const DOCUSIGN_USERINFO_URL = 'https://account-d.docusign.com/oauth/userinfo'

/**
 * DocuSign web-app base for envelope deep links. MUST match the same environment as
 * {@link DOCUSIGN_USERINFO_URL}: demo/sandbox envelopes only exist in the demo web app
 * (`appdemo.docusign.com`), not production (`app.docusign.com`). Keep these in lockstep
 * if the OAuth environment ever changes.
 */
const DOCUSIGN_WEB_BASE = 'https://appdemo.docusign.com'

const DEFAULT_LOOKBACK_DAYS = 90
const MAX_PAGE_SIZE = 100
const DEFAULT_MAX_ENVELOPES = 0
/**
 * Days of overlap added to the incremental sync window. DocuSign status changes are
 * indexed by `statusChangedDateTime`, but webhook/processing lag and clock skew can let
 * a change land slightly before the recorded sync time. A small overlap re-scans recent
 * envelopes so late-recorded changes are not missed.
 */
const INCREMENTAL_OVERLAP_DAYS = 2
const MS_PER_DAY = 24 * 60 * 60 * 1000

interface DocuSignAccount {
  account_id?: string
  base_uri?: string
  is_default?: boolean
}

interface DocuSignUserInfo {
  accounts?: DocuSignAccount[]
}

interface ResolvedAccount {
  accountId: string
  baseUri: string
}

interface DocuSignSigner {
  recipientId?: string
  name?: string
  email?: string
  status?: string
}

interface DocuSignRecipients {
  signers?: DocuSignSigner[]
  carbonCopies?: DocuSignSigner[]
  agents?: DocuSignSigner[]
  editors?: DocuSignSigner[]
  certifiedDeliveries?: DocuSignSigner[]
}

interface DocuSignCustomField {
  name?: string
  value?: string
}

interface DocuSignCustomFields {
  textCustomFields?: DocuSignCustomField[]
  listCustomFields?: DocuSignCustomField[]
}

interface DocuSignDocument {
  documentId?: string
  name?: string
}

interface DocuSignEnvelope {
  envelopeId?: string
  status?: string
  emailSubject?: string
  emailBlurb?: string
  sentDateTime?: string
  completedDateTime?: string
  createdDateTime?: string
  statusChangedDateTime?: string
  lastModifiedDateTime?: string
  sender?: { userName?: string; email?: string }
  recipients?: DocuSignRecipients
  customFields?: DocuSignCustomFields
  envelopeDocuments?: DocuSignDocument[]
}

interface DocuSignEnvelopesListResponse {
  envelopes?: DocuSignEnvelope[]
  resultSetSize?: string
  totalSetSize?: string
  endPosition?: string
  nextUri?: string
}

interface DocuSignFormValue {
  name?: string
  value?: string
}

interface DocuSignRecipientFormData {
  formData?: DocuSignFormValue[]
}

/**
 * Response shape of the envelope `form_data` endpoint. The envelope-level entered tab
 * values are returned as a top-level `formData` array of `{ name, value }` pairs (there
 * is no nested `formValues` property). Per-recipient values live under `recipientFormData`.
 */
interface DocuSignFormData {
  formData?: DocuSignFormValue[]
  recipientFormData?: DocuSignRecipientFormData[]
}

/**
 * Formats a Date as a UTC ISO 8601 string with explicit time zone offset, the format
 * DocuSign recommends for the `from_date` filter on listStatusChanges.
 */
function formatFromDate(date: Date): string {
  return date.toISOString()
}

/**
 * Computes the effective lookback window in days, narrowing to the time since the last
 * successful sync (plus an overlap to catch late-recorded status changes) when incremental
 * sync is active.
 */
function computeLookbackDays(
  sourceConfig: Record<string, unknown>,
  lastSyncAt: Date | undefined
): number {
  const raw = sourceConfig.lookback as string | undefined
  const configured = Number(raw)
  const baseline =
    Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_LOOKBACK_DAYS

  if (!lastSyncAt) return baseline

  const sinceLastSync = Math.ceil((Date.now() - lastSyncAt.getTime()) / MS_PER_DAY)
  const incremental = Math.max(sinceLastSync + INCREMENTAL_OVERLAP_DAYS, INCREMENTAL_OVERLAP_DAYS)
  return Math.min(incremental, baseline)
}

/**
 * Resolves and caches the user's DocuSign account ID and base URI in the sync context.
 * The userinfo lookup is expensive and identical across every page of a sync run, so it is
 * cached on the shared `syncContext` (mirrors the Gmail connector's label cache pattern).
 */
async function resolveAccount(
  accessToken: string,
  syncContext: Record<string, unknown> | undefined,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<ResolvedAccount> {
  const cacheKey = '_docusignAccount'
  const cached = syncContext?.[cacheKey] as ResolvedAccount | undefined
  if (cached) return cached

  const response = await fetchWithRetry(
    DOCUSIGN_USERINFO_URL,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to resolve DocuSign account: ${response.status}${
        errorText ? ` — ${errorText.slice(0, 200)}` : ''
      }`
    )
  }

  const data = (await response.json()) as DocuSignUserInfo
  const accounts = Array.isArray(data.accounts) ? data.accounts : []
  const account = accounts.find((a) => a.is_default) ?? accounts[0]

  if (!account?.account_id || !account.base_uri) {
    throw new Error('No accessible DocuSign account found for this user')
  }

  const resolved: ResolvedAccount = {
    accountId: account.account_id,
    baseUri: account.base_uri,
  }
  if (syncContext) syncContext[cacheKey] = resolved
  return resolved
}

/**
 * Builds the REST API base for an account, e.g.
 * `https://demo.docusign.net/restapi/v2.1/accounts/{accountId}`.
 */
function apiBaseFor(account: ResolvedAccount): string {
  return `${account.baseUri}/restapi/v2.1/accounts/${account.accountId}`
}

/**
 * Builds a metadata-based content hash. Identical between the listDocuments stub and the
 * getDocument result so the sync engine can detect changes without downloading content.
 */
function buildContentHash(envelope: DocuSignEnvelope): string {
  const envelopeId = envelope.envelopeId ?? ''
  const changeIndicator =
    envelope.statusChangedDateTime ?? envelope.lastModifiedDateTime ?? envelope.status ?? ''
  return `docusign:${envelopeId}:${changeIndicator}`
}

/**
 * Builds a DocuSign web console link to the envelope, when an envelope ID is present.
 */
function buildSourceUrl(envelopeId: string | undefined): string | undefined {
  if (!envelopeId) return undefined
  return `${DOCUSIGN_WEB_BASE}/documents/details/${envelopeId}`
}

/**
 * Resolves the sender's display name. The envelope summary exposes sender details only via
 * the nested `sender` (userInfo) object — there is no top-level `senderName` field.
 */
function resolveSenderName(envelope: DocuSignEnvelope): string | undefined {
  return envelope.sender?.userName ?? undefined
}

/**
 * Resolves the sender's email. As with the name, this is only available on the nested
 * `sender` (userInfo) object.
 */
function resolveSenderEmail(envelope: DocuSignEnvelope): string | undefined {
  return envelope.sender?.email ?? undefined
}

/**
 * Collects all named recipients across roles into a flat list of name/email/status entries.
 */
function collectRecipients(
  recipients: DocuSignRecipients | undefined
): { name: string; email: string; status: string }[] {
  if (!recipients) return []
  const groups = [
    recipients.signers,
    recipients.agents,
    recipients.editors,
    recipients.carbonCopies,
    recipients.certifiedDeliveries,
  ]
  const out: { name: string; email: string; status: string }[] = []
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const r of group) {
      out.push({
        name: r.name?.trim() ?? '',
        email: r.email?.trim() ?? '',
        status: r.status?.trim() ?? '',
      })
    }
  }
  return out
}

/**
 * Builds shared metadata used by both the stub and the full document (and by mapTags).
 *
 * Every field consumed by `mapTags` is read from the envelope object that the list
 * endpoint (`GET /envelopes?from_date=...`) returns directly on each list entry — the
 * list response carries the full envelope summary (status, subject, sender, and all
 * lifecycle timestamps), not a thin stub. The sync engine calls `mapTags` on this stub
 * metadata, so tags are populated without any per-envelope detail fetch.
 */
function buildMetadata(envelope: DocuSignEnvelope): Record<string, unknown> {
  const recipients = collectRecipients(envelope.recipients)
  return {
    status: envelope.status,
    subject: envelope.emailSubject,
    senderName: resolveSenderName(envelope),
    senderEmail: resolveSenderEmail(envelope),
    sentDate: envelope.sentDateTime,
    completedDate: envelope.completedDateTime,
    recipientNames: recipients.map((r) => r.name).filter(Boolean),
  }
}

/**
 * Creates a lightweight document stub from an envelope list entry. No per-envelope API
 * calls are made — content is fetched lazily by getDocument for new/changed envelopes only.
 */
function envelopeToStub(envelope: DocuSignEnvelope): ExternalDocument {
  return {
    externalId: envelope.envelopeId ?? '',
    title: envelope.emailSubject?.trim() || 'Untitled DocuSign Envelope',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(envelope.envelopeId),
    contentHash: buildContentHash(envelope),
    metadata: buildMetadata(envelope),
  }
}

/**
 * Renders the envelope's text metadata into a plain-text document. Envelope documents are
 * PDFs/binary and are intentionally NOT downloaded or text-extracted — only the document
 * names are indexed alongside subject, status, sender, recipients, custom fields, and form
 * data field name/value pairs.
 */
function buildContent(
  envelope: DocuSignEnvelope,
  customFields: DocuSignCustomField[],
  documents: DocuSignDocument[],
  formValues: DocuSignFormValue[]
): string {
  const parts: string[] = []

  if (envelope.emailSubject) parts.push(`Subject: ${envelope.emailSubject}`)
  if (envelope.emailBlurb) parts.push(`Message: ${envelope.emailBlurb}`)
  if (envelope.status) parts.push(`Status: ${envelope.status}`)

  const senderName = resolveSenderName(envelope)
  const senderEmail = resolveSenderEmail(envelope)
  if (senderName || senderEmail) {
    parts.push(`Sender: ${[senderName, senderEmail].filter(Boolean).join(' ')}`.trim())
  }
  if (envelope.sentDateTime) parts.push(`Sent: ${envelope.sentDateTime}`)
  if (envelope.completedDateTime) parts.push(`Completed: ${envelope.completedDateTime}`)

  const recipients = collectRecipients(envelope.recipients)
  if (recipients.length > 0) {
    parts.push('')
    parts.push('--- Recipients ---')
    for (const r of recipients) {
      const label = [r.name, r.email ? `<${r.email}>` : '', r.status ? `(${r.status})` : '']
        .filter(Boolean)
        .join(' ')
      if (label) parts.push(label)
    }
  }

  const fields = customFields.filter((f) => f.name?.trim())
  if (fields.length > 0) {
    parts.push('')
    parts.push('--- Custom Fields ---')
    for (const f of fields) {
      parts.push(`${f.name}: ${f.value ?? ''}`)
    }
  }

  const docNames = documents.map((d) => d.name?.trim()).filter((n): n is string => Boolean(n))
  if (docNames.length > 0) {
    parts.push('')
    parts.push('--- Documents ---')
    for (const name of docNames) parts.push(name)
  }

  const formPairs = formValues.filter((v) => v.name?.trim())
  if (formPairs.length > 0) {
    parts.push('')
    parts.push('--- Form Data ---')
    for (const v of formPairs) {
      parts.push(`${v.name}: ${v.value ?? ''}`)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Fetches the envelope's form data (signer-entered tab values). Returns an empty list on
 * 404 or any error — form data is supplementary and a missing endpoint must not fail the doc.
 */
async function fetchFormValues(
  apiBase: string,
  accessToken: string,
  envelopeId: string
): Promise<DocuSignFormValue[]> {
  try {
    const response = await fetchWithRetry(`${apiBase}/envelopes/${envelopeId}/form_data`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) return []
    const data = (await response.json()) as DocuSignFormData
    const values: DocuSignFormValue[] = []
    if (Array.isArray(data.formData)) values.push(...data.formData)
    if (Array.isArray(data.recipientFormData)) {
      for (const recipient of data.recipientFormData) {
        if (Array.isArray(recipient.formData)) values.push(...recipient.formData)
      }
    }
    return values
  } catch (error) {
    logger.warn('Failed to fetch DocuSign form data', {
      envelopeId,
      error: toError(error).message,
    })
    return []
  }
}

export const docusignConnector: ConnectorConfig = {
  id: 'docusign',
  name: 'DocuSign',
  description: 'Sync envelope and agreement metadata from DocuSign into your knowledge base',
  version: '1.0.0',
  icon: DocuSignIcon,

  auth: {
    mode: 'oauth',
    provider: 'docusign',
    requiredScopes: ['signature'],
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'lookback',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days', id: '30' },
        { label: 'Last 90 days (recommended)', id: '90' },
        { label: 'Last 6 months', id: '180' },
      ],
      description:
        'On initial sync only. Filters envelopes by when their status last changed (from_date).',
    },
    {
      id: 'status',
      title: 'Filter by Status',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. completed (or completed,sent)',
      description:
        'Only sync envelopes with these statuses (comma-separated: created, sent, delivered, completed, declined, voided). Leave blank to sync all.',
    },
    {
      id: 'maxEnvelopes',
      title: 'Max Envelopes',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const account = await resolveAccount(accessToken, syncContext)
    const apiBase = apiBaseFor(account)

    const lookbackDays = computeLookbackDays(sourceConfig, lastSyncAt)
    const maxEnvelopes = sourceConfig.maxEnvelopes
      ? Number(sourceConfig.maxEnvelopes)
      : DEFAULT_MAX_ENVELOPES

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    if (maxEnvelopes > 0 && prevFetched >= maxEnvelopes) {
      return { documents: [], hasMore: false }
    }

    const startPosition = cursor ? Number(cursor) : 0
    const cachedFromDate = syncContext?.docusignFromDate as string | undefined
    const fromDate = cachedFromDate
      ? new Date(cachedFromDate)
      : new Date(Date.now() - lookbackDays * MS_PER_DAY)
    if (syncContext && !cachedFromDate) syncContext.docusignFromDate = fromDate.toISOString()

    const queryParams = new URLSearchParams({
      from_date: formatFromDate(fromDate),
      include: 'recipients,custom_fields',
      count: String(MAX_PAGE_SIZE),
      start_position: String(startPosition),
    })
    const statusFilter = typeof sourceConfig.status === 'string' ? sourceConfig.status.trim() : ''
    if (statusFilter) queryParams.set('status', statusFilter)

    const url = `${apiBase}/envelopes?${queryParams.toString()}`

    logger.info('Listing DocuSign envelopes', {
      from: formatFromDate(fromDate),
      startPosition,
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list DocuSign envelopes', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list DocuSign envelopes: ${response.status}`)
    }

    const data = (await response.json()) as DocuSignEnvelopesListResponse
    const envelopes = (data.envelopes ?? []).filter((e) => e.envelopeId)
    const pageDocuments = envelopes.map(envelopeToStub)

    let documents = pageDocuments
    if (maxEnvelopes > 0) {
      const remaining = Math.max(0, maxEnvelopes - prevFetched)
      if (pageDocuments.length > remaining) {
        documents = pageDocuments.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const hitLimit = maxEnvelopes > 0 && totalFetched >= maxEnvelopes
    if (hitLimit && syncContext) syncContext.listingCapped = true

    const endPosition = Number(data.endPosition)
    const totalSetSize = Number(data.totalSetSize)
    const hasNextPage =
      pageDocuments.length === MAX_PAGE_SIZE &&
      Number.isFinite(endPosition) &&
      Number.isFinite(totalSetSize) &&
      endPosition + 1 < totalSetSize

    return {
      documents,
      nextCursor: !hitLimit && hasNextPage ? String(endPosition + 1) : undefined,
      hasMore: !hitLimit && hasNextPage,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    try {
      if (!externalId) return null

      const account = await resolveAccount(accessToken, syncContext)
      const apiBase = apiBaseFor(account)

      const response = await fetchWithRetry(
        `${apiBase}/envelopes/${externalId}?include=recipients,custom_fields,documents`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      )

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) return null
        throw new Error(`Failed to fetch DocuSign envelope: ${response.status}`)
      }

      const envelope = (await response.json()) as DocuSignEnvelope
      if (!envelope.envelopeId) return null

      const customFields: DocuSignCustomField[] = [
        ...(envelope.customFields?.textCustomFields ?? []),
        ...(envelope.customFields?.listCustomFields ?? []),
      ]

      const documents = Array.isArray(envelope.envelopeDocuments) ? envelope.envelopeDocuments : []

      const formValues = await fetchFormValues(apiBase, accessToken, externalId)

      const content = buildContent(envelope, customFields, documents, formValues)
      if (!content.trim()) return null

      return {
        externalId: envelope.envelopeId,
        title: envelope.emailSubject?.trim() || 'Untitled DocuSign Envelope',
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: buildSourceUrl(envelope.envelopeId),
        contentHash: buildContentHash(envelope),
        metadata: buildMetadata(envelope),
      }
    } catch (error) {
      logger.warn('Failed to get DocuSign envelope', {
        externalId,
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxEnvelopes = sourceConfig.maxEnvelopes as string | undefined
    if (maxEnvelopes && (Number.isNaN(Number(maxEnvelopes)) || Number(maxEnvelopes) < 0)) {
      return { valid: false, error: 'Max envelopes must be a non-negative number' }
    }

    try {
      await resolveAccount(accessToken, undefined, VALIDATE_RETRY_OPTIONS)
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  /**
   * Tag definitions are constrained by the document table's slot pools: 7 text slots but
   * only 2 date slots (`date1`, `date2`). The two highest-value envelope dates — when it was
   * sent and when it completed — claim both date slots. `createdDateTime` is intentionally
   * NOT exposed as a date tag: it nearly always equals `sentDateTime` for sent envelopes, so
   * adding it would consume a (non-existent) third date slot and be silently dropped by the
   * slot allocator. `emailSubject` is exposed as a filterable text tag (distinct from the
   * document title) since text slots are plentiful.
   */
  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'sender', displayName: 'Sender', fieldType: 'text' },
    { id: 'subject', displayName: 'Subject', fieldType: 'text' },
    { id: 'sentDate', displayName: 'Sent Date', fieldType: 'date' },
    { id: 'completedDate', displayName: 'Completed Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.status === 'string' && metadata.status.trim()) {
      result.status = metadata.status
    }

    const sender = [metadata.senderName, metadata.senderEmail]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join(' ')
      .trim()
    if (sender) result.sender = sender

    if (typeof metadata.subject === 'string' && metadata.subject.trim()) {
      result.subject = metadata.subject.trim()
    }

    const sentDate = parseTagDate(metadata.sentDate)
    if (sentDate) result.sentDate = sentDate

    const completedDate = parseTagDate(metadata.completedDate)
    if (completedDate) result.completedDate = completedDate

    return result
  },
}
