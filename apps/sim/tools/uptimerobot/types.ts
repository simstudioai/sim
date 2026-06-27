import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Base URL for the UptimeRobot v3 REST API. */
export const UPTIMEROBOT_API_BASE = 'https://api.uptimerobot.com/v3'

/** Every UptimeRobot tool authenticates with the account API key as a Bearer token. */
interface UptimeRobotBaseParams {
  apiKey: string
}

/**
 * Builds the standard Bearer auth headers shared by every UptimeRobot request.
 */
export function uptimeRobotHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }
}

/**
 * Extracts a human-readable error message from a non-OK UptimeRobot response.
 * The v3 API returns `{ error: true, message: string }` on failures.
 */
export async function uptimeRobotError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text)
    if (parsed?.message) return String(parsed.message)
  } catch {
    // Fall through to the raw body.
  }
  return text || `UptimeRobot API error (HTTP ${response.status})`
}

// region Shared object shapes

export interface UptimeRobotTag {
  id: number
  name: string
  color: string | null
}

export interface UptimeRobotAssignedAlertContact {
  alertContactId: number
  threshold: number
  recurrence: number
}

export interface UptimeRobotLastIncident {
  id: string
  status: string | null
  cause: number | null
  reason: string | null
  startedAt: string | null
  duration: number | null
}

export interface UptimeRobotMonitor {
  id: number
  friendlyName: string
  url: string | null
  type: string | null
  status: string | null
  interval: number | null
  timeout: number | null
  port: number | null
  keywordType: string | null
  keywordValue: string | null
  httpMethodType: string | null
  authType: string | null
  successHttpResponseCodes: string[]
  checkSSLErrors: boolean | null
  followRedirections: boolean | null
  sslExpirationReminder: boolean | null
  domainExpirationReminder: boolean | null
  responseTimeThreshold: number | null
  currentStateDuration: number | null
  lastIncidentId: string | null
  groupId: number | null
  tags: UptimeRobotTag[]
  assignedAlertContacts: UptimeRobotAssignedAlertContact[]
  lastIncident: UptimeRobotLastIncident | null
  createDateTime: string | null
}

export interface UptimeRobotMaintenanceWindow {
  id: number
  userId: number | null
  name: string
  interval: string | null
  date: string | null
  time: string | null
  duration: number | null
  autoAddMonitors: boolean | null
  monitorIds: number[]
  days: number[]
  status: string | null
  created: string | null
}

export interface UptimeRobotAlertContact {
  id: number
  friendlyName: string | null
  type: string | null
  value: string | null
  customValue: string | null
  status: string | null
  enableNotificationsFor: number | string | null
  sslExpirationReminder: boolean | null
}

export interface UptimeRobotPsp {
  id: number
  friendlyName: string
  customDomain: string | null
  isPasswordSet: boolean | null
  monitorIds: number[]
  tagIds: number[]
  monitorsCount: number | null
  status: string | null
  urlKey: string | null
  homepageLink: string | null
  gaCode: string | null
  icon: string | null
  logo: string | null
  noIndex: boolean | null
  hideUrlLinks: boolean | null
  subscription: boolean | null
}

export interface UptimeRobotIncidentSummary {
  id: string
  status: string | null
  type: string | null
  cause: number | null
  reason: string | null
  monitorId: number | null
  monitorName: string | null
  commentsCount: number | null
  startedAt: string | null
  resolvedAt: string | null
  duration: number | null
  includeInReports: boolean | null
}

export interface UptimeRobotIncidentRootCause {
  url: string | null
  httpResponseCode: number | null
  responseDownloadUrl: string | null
}

export interface UptimeRobotIncidentDetail {
  id: string
  status: string | null
  cause: number | null
  reason: string | null
  duration: number | null
  startedAt: string | null
  resolvedAt: string | null
  rootCause: UptimeRobotIncidentRootCause | null
}

export interface UptimeRobotAccount {
  email: string | null
  fullName: string | null
  monitorsCount: number | null
  monitorLimit: number | null
  smsCredits: number | null
  plan: string | null
  subscriptionStatus: string | null
  subscriptionExpiresAt: string | null
}

// endregion

// region Raw API value coercion helpers

type Raw = Record<string, unknown>

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asEnum(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asObject(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

// endregion

// region Request body builders

/** Splits a comma-separated string into trimmed, non-empty parts. */
function parseCsv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value !== 'string') return undefined
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

/** Splits a comma-separated string of integers into a number array. */
function parseNumberCsv(value: unknown): number[] | undefined {
  const parts = parseCsv(value)
  if (!parts) return undefined
  const numbers = parts.map(Number).filter((n) => !Number.isNaN(n))
  return numbers.length > 0 ? numbers : undefined
}

/** Parses a JSON string (or passes through an already-parsed value). */
function parseJson(value: unknown): unknown {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function assignDefined(body: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    body[key] = value
  }
}

/**
 * Builds the JSON body for create/update monitor requests. UptimeRobot uses the
 * same field set for both; `PATCH` simply omits the fields the caller leaves out.
 */
export function buildMonitorBody(
  params: Partial<UptimeRobotCreateMonitorParams>
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  assignDefined(body, 'friendlyName', params.friendlyName)
  assignDefined(body, 'type', params.type)
  assignDefined(body, 'url', params.url)
  assignDefined(body, 'interval', params.interval)
  assignDefined(body, 'timeout', params.timeout)
  assignDefined(body, 'port', params.port)
  assignDefined(body, 'keywordType', params.keywordType)
  assignDefined(body, 'keywordValue', params.keywordValue)
  assignDefined(body, 'keywordCaseType', params.keywordCaseType)
  assignDefined(body, 'httpMethodType', params.httpMethodType)
  assignDefined(body, 'authType', params.authType)
  assignDefined(body, 'httpUsername', params.httpUsername)
  assignDefined(body, 'httpPassword', params.httpPassword)
  assignDefined(body, 'gracePeriod', params.gracePeriod)
  assignDefined(body, 'responseTimeThreshold', params.responseTimeThreshold)
  assignDefined(body, 'checkSSLErrors', params.checkSSLErrors)
  assignDefined(body, 'followRedirections', params.followRedirections)
  assignDefined(body, 'sslExpirationReminder', params.sslExpirationReminder)
  assignDefined(body, 'domainExpirationReminder', params.domainExpirationReminder)
  assignDefined(body, 'groupId', params.groupId)
  assignDefined(body, 'successHttpResponseCodes', parseCsv(params.successHttpResponseCodes))
  assignDefined(body, 'tagNames', parseCsv(params.tagNames))
  assignDefined(body, 'assignedAlertContacts', parseJson(params.assignedAlertContacts))
  assignDefined(body, 'customHttpHeaders', parseJson(params.customHttpHeaders))
  return body
}

/** Builds the JSON body for create/update maintenance window requests. */
export function buildMaintenanceWindowBody(
  params: Partial<UptimeRobotCreateMaintenanceWindowParams> & { status?: string }
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  assignDefined(body, 'name', params.name)
  assignDefined(body, 'interval', params.interval)
  assignDefined(body, 'date', params.date)
  assignDefined(body, 'time', params.time)
  assignDefined(body, 'duration', params.duration)
  assignDefined(body, 'autoAddMonitors', params.autoAddMonitors)
  assignDefined(body, 'days', parseNumberCsv(params.days))
  assignDefined(body, 'monitorIds', parseNumberCsv(params.monitorIds))
  assignDefined(body, 'status', params.status)
  return body
}

// endregion

// region Mappers (raw API JSON -> typed output objects)

export function mapMonitor(raw: Raw): UptimeRobotMonitor {
  const lastIncident = asObject(raw.lastIncident)
  return {
    id: asNumber(raw.id) ?? 0,
    friendlyName: asString(raw.friendlyName) ?? '',
    url: asString(raw.url),
    type: asEnum(raw.type),
    status: asEnum(raw.status),
    interval: asNumber(raw.interval),
    timeout: asNumber(raw.timeout),
    port: asNumber(raw.port),
    keywordType: asEnum(raw.keywordType),
    keywordValue: asString(raw.keywordValue),
    httpMethodType: asEnum(raw.httpMethodType),
    authType: asEnum(raw.authType),
    successHttpResponseCodes: asArray(raw.successHttpResponseCodes).filter(
      (code): code is string => typeof code === 'string'
    ),
    checkSSLErrors: asBoolean(raw.checkSSLErrors),
    followRedirections: asBoolean(raw.followRedirections),
    sslExpirationReminder: asBoolean(raw.sslExpirationReminder),
    domainExpirationReminder: asBoolean(raw.domainExpirationReminder),
    responseTimeThreshold: asNumber(raw.responseTimeThreshold),
    currentStateDuration: asNumber(raw.currentStateDuration),
    lastIncidentId: asString(raw.lastIncidentId),
    groupId: asNumber(raw.groupId),
    tags: asArray(raw.tags).map((tag) => {
      const t = asObject(tag) ?? {}
      return {
        id: asNumber(t.id) ?? 0,
        name: asString(t.name) ?? '',
        color: asString(t.color),
      }
    }),
    assignedAlertContacts: asArray(raw.assignedAlertContacts).map((contact) => {
      const c = asObject(contact) ?? {}
      return {
        alertContactId: asNumber(c.alertContactId) ?? 0,
        threshold: asNumber(c.threshold) ?? 0,
        recurrence: asNumber(c.recurrence) ?? 0,
      }
    }),
    lastIncident: lastIncident
      ? {
          id: asString(lastIncident.id) ?? '',
          status: asEnum(lastIncident.status),
          cause: asNumber(lastIncident.cause),
          reason: asString(lastIncident.reason),
          startedAt: asString(lastIncident.startedAt),
          duration: asNumber(lastIncident.duration),
        }
      : null,
    createDateTime: asString(raw.createDateTime),
  }
}

export function mapMaintenanceWindow(raw: Raw): UptimeRobotMaintenanceWindow {
  return {
    id: asNumber(raw.id) ?? 0,
    userId: asNumber(raw.userId),
    name: asString(raw.name) ?? '',
    interval: asEnum(raw.interval),
    date: asString(raw.date),
    time: asString(raw.time),
    duration: asNumber(raw.duration),
    autoAddMonitors: asBoolean(raw.autoAddMonitors),
    monitorIds: asArray(raw.monitorIds).filter((id): id is number => typeof id === 'number'),
    days: asArray(raw.days).filter((day): day is number => typeof day === 'number'),
    status: asEnum(raw.status),
    created: asString(raw.created),
  }
}

export function mapAlertContact(raw: Raw): UptimeRobotAlertContact {
  const notify = raw.enableNotificationsFor
  return {
    id: asNumber(raw.id) ?? 0,
    friendlyName: asString(raw.friendlyName),
    type: asEnum(raw.type),
    value: asString(raw.value),
    customValue: asString(raw.customValue),
    status: asEnum(raw.status),
    enableNotificationsFor:
      typeof notify === 'number' || typeof notify === 'string' ? notify : null,
    sslExpirationReminder: asBoolean(raw.sslExpirationReminder),
  }
}

export function mapPsp(raw: Raw): UptimeRobotPsp {
  return {
    id: asNumber(raw.id) ?? 0,
    friendlyName: asString(raw.friendlyName) ?? '',
    customDomain: asString(raw.customDomain),
    isPasswordSet: asBoolean(raw.isPasswordSet),
    monitorIds: asArray(raw.monitorIds).filter((id): id is number => typeof id === 'number'),
    tagIds: asArray(raw.tagIds).filter((id): id is number => typeof id === 'number'),
    monitorsCount: asNumber(raw.monitorsCount),
    status: asEnum(raw.status),
    urlKey: asString(raw.urlKey),
    homepageLink: asString(raw.homepageLink),
    gaCode: asString(raw.gaCode),
    icon: asString(raw.icon),
    logo: asString(raw.logo),
    noIndex: asBoolean(raw.noIndex),
    hideUrlLinks: asBoolean(raw.hideUrlLinks),
    subscription: asBoolean(raw.subscription),
  }
}

export function mapIncidentSummary(raw: Raw): UptimeRobotIncidentSummary {
  const monitor = asObject(raw.monitor) ?? {}
  return {
    id: asString(raw.id) ?? '',
    status: asEnum(raw.status),
    type: asEnum(raw.type),
    cause: asNumber(raw.cause),
    reason: asString(raw.reason),
    monitorId: asNumber(monitor.id),
    monitorName: asString(monitor.friendlyName),
    commentsCount: asNumber(raw.commentsCount),
    startedAt: asString(raw.startedAt),
    resolvedAt: asString(raw.resolvedAt),
    duration: asNumber(raw.duration),
    includeInReports: asBoolean(raw.includeInReports),
  }
}

export function mapIncidentDetail(raw: Raw): UptimeRobotIncidentDetail {
  const rootCause = asObject(raw.rootCause)
  return {
    id: asString(raw.id) ?? '',
    status: asEnum(raw.status),
    cause: asNumber(raw.cause),
    reason: asString(raw.reason),
    duration: asNumber(raw.duration),
    startedAt: asString(raw.startedAt),
    resolvedAt: asString(raw.resolvedAt),
    rootCause: rootCause
      ? {
          url: asString(rootCause.url),
          httpResponseCode: asNumber(rootCause.httpResponseCode),
          responseDownloadUrl: asString(rootCause.responseDownloadUrl),
        }
      : null,
  }
}

export function mapAccount(raw: Raw): UptimeRobotAccount {
  const subscription = asObject(raw.activeSubscription) ?? {}
  return {
    email: asString(raw.email),
    fullName: asString(raw.fullName),
    monitorsCount: asNumber(raw.monitorsCount),
    monitorLimit: asNumber(raw.monitorLimit),
    smsCredits: asNumber(raw.smsCredits),
    plan: asString(subscription.plan),
    subscriptionStatus: asString(subscription.status),
    subscriptionExpiresAt: asString(subscription.expirationDate),
  }
}

// endregion

// region Output property definitions (shared by tool `outputs`)

export const MONITOR_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Monitor ID' },
  friendlyName: { type: 'string', description: 'Friendly name of the monitor' },
  url: { type: 'string', description: 'Monitored URL or host', nullable: true },
  type: {
    type: 'string',
    description: 'Monitor type (HTTP, KEYWORD, PING, PORT, HEARTBEAT, DNS, API, UDP)',
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Current status (UP, DOWN, PAUSED, etc.)',
    nullable: true,
  },
  interval: { type: 'number', description: 'Check interval in seconds', nullable: true },
  timeout: { type: 'number', description: 'Check timeout in seconds', nullable: true },
  port: { type: 'number', description: 'Port for Port/UDP monitors', nullable: true },
  keywordType: {
    type: 'string',
    description: 'Keyword match type for Keyword monitors',
    nullable: true,
  },
  keywordValue: {
    type: 'string',
    description: 'Keyword to match for Keyword monitors',
    nullable: true,
  },
  httpMethodType: { type: 'string', description: 'HTTP method used for the check', nullable: true },
  authType: { type: 'string', description: 'HTTP authentication method', nullable: true },
  successHttpResponseCodes: {
    type: 'array',
    description: 'HTTP response codes treated as success',
    items: { type: 'string' },
  },
  checkSSLErrors: {
    type: 'boolean',
    description: 'Whether SSL/domain expiration errors are checked',
    nullable: true,
  },
  followRedirections: {
    type: 'boolean',
    description: 'Whether redirects are followed',
    nullable: true,
  },
  sslExpirationReminder: {
    type: 'boolean',
    description: 'Whether SSL expiration reminders are enabled',
    nullable: true,
  },
  domainExpirationReminder: {
    type: 'boolean',
    description: 'Whether domain expiration reminders are enabled',
    nullable: true,
  },
  responseTimeThreshold: {
    type: 'number',
    description: 'Response time threshold in milliseconds',
    nullable: true,
  },
  currentStateDuration: {
    type: 'number',
    description: 'Seconds spent in the current state',
    nullable: true,
  },
  lastIncidentId: { type: 'string', description: 'ID of the most recent incident', nullable: true },
  groupId: { type: 'number', description: 'Monitor group ID (0 if ungrouped)', nullable: true },
  createDateTime: { type: 'string', description: 'When the monitor was created', nullable: true },
  tags: {
    type: 'array',
    description: 'Tags assigned to the monitor',
    items: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Tag ID' },
        name: { type: 'string', description: 'Tag name' },
        color: { type: 'string', description: 'Tag color', nullable: true },
      },
    },
  },
  assignedAlertContacts: {
    type: 'array',
    description: 'Alert contacts assigned to the monitor',
    items: {
      type: 'object',
      properties: {
        alertContactId: { type: 'number', description: 'Alert contact ID' },
        threshold: { type: 'number', description: 'Notification delay threshold in minutes' },
        recurrence: { type: 'number', description: 'Repeat notification interval in minutes' },
      },
    },
  },
  lastIncident: {
    type: 'object',
    description: 'Details of the most recent incident',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Incident ID' },
      status: { type: 'string', description: 'Incident status', nullable: true },
      cause: { type: 'number', description: 'Incident cause code', nullable: true },
      reason: { type: 'string', description: 'Incident reason', nullable: true },
      startedAt: { type: 'string', description: 'When the incident started', nullable: true },
      duration: { type: 'number', description: 'Incident duration in seconds', nullable: true },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const MAINTENANCE_WINDOW_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Maintenance window ID' },
  userId: { type: 'number', description: 'Owner user ID', nullable: true },
  name: { type: 'string', description: 'Maintenance window name' },
  interval: {
    type: 'string',
    description: 'Recurrence interval (once, daily, weekly, monthly)',
    nullable: true,
  },
  date: { type: 'string', description: 'Start date (YYYY-MM-DD)', nullable: true },
  time: { type: 'string', description: 'Start time (HH:mm:ss)', nullable: true },
  duration: { type: 'number', description: 'Duration in minutes', nullable: true },
  autoAddMonitors: {
    type: 'boolean',
    description: 'Whether all monitors are auto-added',
    nullable: true,
  },
  monitorIds: { type: 'array', description: 'Assigned monitor IDs', items: { type: 'number' } },
  days: {
    type: 'array',
    description: 'Days for weekly/monthly recurrence',
    items: { type: 'number' },
  },
  status: { type: 'string', description: 'Status (active or paused)', nullable: true },
  created: {
    type: 'string',
    description: 'When the maintenance window was created',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ALERT_CONTACT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Alert contact ID' },
  friendlyName: { type: 'string', description: 'Display name', nullable: true },
  type: { type: 'string', description: 'Alert contact type', nullable: true },
  value: { type: 'string', description: 'Contact value (e.g. email address)', nullable: true },
  customValue: {
    type: 'string',
    description: 'Custom value for webhook-style contacts',
    nullable: true,
  },
  status: { type: 'string', description: 'Activation status', nullable: true },
  enableNotificationsFor: {
    type: 'string',
    description: 'Which monitor events trigger notifications',
    nullable: true,
  },
  sslExpirationReminder: {
    type: 'boolean',
    description: 'Whether SSL expiration reminders are enabled',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PSP_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Public status page ID' },
  friendlyName: { type: 'string', description: 'Status page name' },
  customDomain: { type: 'string', description: 'Custom domain', nullable: true },
  isPasswordSet: {
    type: 'boolean',
    description: 'Whether the page is password protected',
    nullable: true,
  },
  monitorIds: {
    type: 'array',
    description: 'Monitor IDs shown on the page',
    items: { type: 'number' },
  },
  tagIds: { type: 'array', description: 'Tag IDs shown on the page', items: { type: 'number' } },
  monitorsCount: { type: 'number', description: 'Number of monitors on the page', nullable: true },
  status: { type: 'string', description: 'Status (ENABLED or PAUSED)', nullable: true },
  urlKey: { type: 'string', description: 'Public URL key', nullable: true },
  homepageLink: { type: 'string', description: 'Homepage link target', nullable: true },
  gaCode: { type: 'string', description: 'Google Analytics code', nullable: true },
  icon: { type: 'string', description: 'Icon URL', nullable: true },
  logo: { type: 'string', description: 'Logo URL', nullable: true },
  noIndex: {
    type: 'boolean',
    description: 'Whether search engine indexing is disabled',
    nullable: true,
  },
  hideUrlLinks: {
    type: 'boolean',
    description: 'Whether the "Powered by" footer link is hidden',
    nullable: true,
  },
  subscription: {
    type: 'boolean',
    description: 'Whether the subscribe feature is enabled',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INCIDENT_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Incident ID' },
  status: { type: 'string', description: 'Incident status', nullable: true },
  type: { type: 'string', description: 'Incident type', nullable: true },
  cause: { type: 'number', description: 'Incident cause code', nullable: true },
  reason: { type: 'string', description: 'Incident reason', nullable: true },
  monitorId: { type: 'number', description: 'Affected monitor ID', nullable: true },
  monitorName: { type: 'string', description: 'Affected monitor name', nullable: true },
  commentsCount: { type: 'number', description: 'Number of comments', nullable: true },
  startedAt: { type: 'string', description: 'When the incident started', nullable: true },
  resolvedAt: { type: 'string', description: 'When the incident resolved', nullable: true },
  duration: { type: 'number', description: 'Incident duration in seconds', nullable: true },
  includeInReports: {
    type: 'boolean',
    description: 'Whether the incident is included in reports',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const INCIDENT_DETAIL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Incident ID' },
  status: { type: 'string', description: 'Incident status', nullable: true },
  cause: { type: 'number', description: 'Incident cause code', nullable: true },
  reason: { type: 'string', description: 'Incident reason', nullable: true },
  duration: { type: 'number', description: 'Incident duration in seconds', nullable: true },
  startedAt: { type: 'string', description: 'When the incident started', nullable: true },
  resolvedAt: { type: 'string', description: 'When the incident resolved', nullable: true },
  rootCause: {
    type: 'object',
    description: 'Root cause details for the incident',
    nullable: true,
    properties: {
      url: { type: 'string', description: 'Checked URL', nullable: true },
      httpResponseCode: {
        type: 'number',
        description: 'HTTP response code observed',
        nullable: true,
      },
      responseDownloadUrl: {
        type: 'string',
        description: 'URL to download the captured response body',
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const ACCOUNT_OUTPUT_PROPERTIES = {
  email: { type: 'string', description: 'Account email', nullable: true },
  fullName: { type: 'string', description: 'Account holder name', nullable: true },
  monitorsCount: {
    type: 'number',
    description: 'Number of monitors in the account',
    nullable: true,
  },
  monitorLimit: {
    type: 'number',
    description: 'Maximum number of monitors allowed',
    nullable: true,
  },
  smsCredits: { type: 'number', description: 'Remaining SMS credits', nullable: true },
  plan: { type: 'string', description: 'Subscription plan name', nullable: true },
  subscriptionStatus: { type: 'string', description: 'Subscription status', nullable: true },
  subscriptionExpiresAt: {
    type: 'string',
    description: 'Subscription expiration date',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

// endregion

// region Tool param/response interfaces

export interface UptimeRobotListMonitorsParams extends UptimeRobotBaseParams {
  limit?: number
  status?: string
  name?: string
  url?: string
  tags?: string
  groupId?: number
  cursor?: number
}

export interface UptimeRobotListMonitorsResponse extends ToolResponse {
  output: {
    monitors: UptimeRobotMonitor[]
    nextLink: string | null
  }
}

export interface UptimeRobotGetMonitorParams extends UptimeRobotBaseParams {
  monitorId: number
}

export interface UptimeRobotMonitorResponse extends ToolResponse {
  output: {
    monitor: UptimeRobotMonitor
  }
}

export interface UptimeRobotCreateMonitorParams extends UptimeRobotBaseParams {
  friendlyName: string
  type: string
  url?: string
  interval: number
  timeout?: number
  port?: number
  keywordType?: string
  keywordValue?: string
  keywordCaseType?: number
  httpMethodType?: string
  authType?: string
  httpUsername?: string
  httpPassword?: string
  gracePeriod?: number
  successHttpResponseCodes?: string
  checkSSLErrors?: boolean
  followRedirections?: boolean
  sslExpirationReminder?: boolean
  domainExpirationReminder?: boolean
  responseTimeThreshold?: number
  tagNames?: string
  assignedAlertContacts?: string
  customHttpHeaders?: string
  groupId?: number
}

export interface UptimeRobotUpdateMonitorParams extends Partial<UptimeRobotCreateMonitorParams> {
  apiKey: string
  monitorId: number
}

export interface UptimeRobotDeleteMonitorParams extends UptimeRobotBaseParams {
  monitorId: number
}

export interface UptimeRobotDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    id: number | null
  }
}

export interface UptimeRobotListIncidentsParams extends UptimeRobotBaseParams {
  monitorId?: number
  monitorName?: string
  startedAfter?: string
  startedBefore?: string
  cursor?: string
}

export interface UptimeRobotListIncidentsResponse extends ToolResponse {
  output: {
    incidents: UptimeRobotIncidentSummary[]
    nextLink: string | null
  }
}

export interface UptimeRobotGetIncidentParams extends UptimeRobotBaseParams {
  incidentId: string
}

export interface UptimeRobotIncidentResponse extends ToolResponse {
  output: {
    incident: UptimeRobotIncidentDetail
  }
}

export interface UptimeRobotListMaintenanceWindowsParams extends UptimeRobotBaseParams {
  cursor?: string
}

export interface UptimeRobotListMaintenanceWindowsResponse extends ToolResponse {
  output: {
    maintenanceWindows: UptimeRobotMaintenanceWindow[]
    nextLink: string | null
  }
}

export interface UptimeRobotGetMaintenanceWindowParams extends UptimeRobotBaseParams {
  maintenanceWindowId: number
}

export interface UptimeRobotMaintenanceWindowResponse extends ToolResponse {
  output: {
    maintenanceWindow: UptimeRobotMaintenanceWindow
  }
}

export interface UptimeRobotCreateMaintenanceWindowParams extends UptimeRobotBaseParams {
  name: string
  interval: string
  date: string
  time: string
  duration: number
  autoAddMonitors?: boolean
  days?: string
  monitorIds?: string
}

export interface UptimeRobotUpdateMaintenanceWindowParams
  extends Partial<UptimeRobotCreateMaintenanceWindowParams> {
  apiKey: string
  maintenanceWindowId: number
  status?: string
}

export interface UptimeRobotDeleteMaintenanceWindowParams extends UptimeRobotBaseParams {
  maintenanceWindowId: number
}

export interface UptimeRobotListAlertContactsParams extends UptimeRobotBaseParams {
  cursor?: number
}

export interface UptimeRobotListAlertContactsResponse extends ToolResponse {
  output: {
    alertContacts: UptimeRobotAlertContact[]
    nextLink: string | null
  }
}

export interface UptimeRobotGetAlertContactParams extends UptimeRobotBaseParams {
  alertContactId: number
}

export interface UptimeRobotAlertContactResponse extends ToolResponse {
  output: {
    alertContact: UptimeRobotAlertContact
  }
}

export interface UptimeRobotCreateAlertContactParams extends UptimeRobotBaseParams {
  value: string
  friendlyName?: string
  enableNotificationsFor?: number
}

export interface UptimeRobotDeleteAlertContactParams extends UptimeRobotBaseParams {
  alertContactId: number
}

export interface UptimeRobotListPspsParams extends UptimeRobotBaseParams {
  cursor?: number
}

export interface UptimeRobotListPspsResponse extends ToolResponse {
  output: {
    psps: UptimeRobotPsp[]
    nextLink: string | null
  }
}

export interface UptimeRobotGetPspParams extends UptimeRobotBaseParams {
  pspId: number
}

export interface UptimeRobotPspResponse extends ToolResponse {
  output: {
    psp: UptimeRobotPsp
  }
}

export interface UptimeRobotCreatePspParams extends UptimeRobotBaseParams {
  friendlyName: string
  monitorIds?: string
  status?: string
  password?: string
  customDomain?: string
  hideUrlLinks?: boolean
  noIndex?: boolean
  logo?: unknown
  icon?: unknown
}

export interface UptimeRobotUpdatePspParams extends Partial<UptimeRobotCreatePspParams> {
  apiKey: string
  pspId: number
}

export interface UptimeRobotDeletePspParams extends UptimeRobotBaseParams {
  pspId: number
}

export interface UptimeRobotGetAccountParams extends UptimeRobotBaseParams {}

export interface UptimeRobotAccountResponse extends ToolResponse {
  output: {
    account: UptimeRobotAccount
  }
}

// endregion
