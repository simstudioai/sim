import { UptimeRobotIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { UptimeRobotMonitorResponse } from '@/tools/uptimerobot/types'

const MONITOR_EDIT_OPS = ['create_monitor', 'update_monitor']
const MAINTENANCE_EDIT_OPS = ['create_maintenance_window', 'update_maintenance_window']
const PSP_EDIT_OPS = ['create_psp', 'update_psp']

export const UptimeRobotBlock: BlockConfig<UptimeRobotMonitorResponse> = {
  type: 'uptimerobot',
  name: 'UptimeRobot',
  description: 'Monitor uptime, manage incidents, maintenance windows, and status pages',
  longDescription:
    'Integrate UptimeRobot into your workflow. Create and manage monitors, inspect incidents, schedule maintenance windows, manage alert contacts, and publish public status pages using the UptimeRobot v3 API.',
  docsLink: 'https://docs.sim.ai/integrations/uptimerobot',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#111921',
  icon: UptimeRobotIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Monitors', id: 'list_monitors' },
        { label: 'Get Monitor', id: 'get_monitor' },
        { label: 'Create Monitor', id: 'create_monitor' },
        { label: 'Update Monitor', id: 'update_monitor' },
        { label: 'Delete Monitor', id: 'delete_monitor' },
        { label: 'Pause Monitor', id: 'pause_monitor' },
        { label: 'Start Monitor', id: 'start_monitor' },
        { label: 'List Incidents', id: 'list_incidents' },
        { label: 'Get Incident', id: 'get_incident' },
        { label: 'List Maintenance Windows', id: 'list_maintenance_windows' },
        { label: 'Get Maintenance Window', id: 'get_maintenance_window' },
        { label: 'Create Maintenance Window', id: 'create_maintenance_window' },
        { label: 'Update Maintenance Window', id: 'update_maintenance_window' },
        { label: 'Delete Maintenance Window', id: 'delete_maintenance_window' },
        { label: 'List Alert Contacts', id: 'list_alert_contacts' },
        { label: 'Get Alert Contact', id: 'get_alert_contact' },
        { label: 'Create Alert Contact', id: 'create_alert_contact' },
        { label: 'Delete Alert Contact', id: 'delete_alert_contact' },
        { label: 'List Status Pages', id: 'list_psps' },
        { label: 'Get Status Page', id: 'get_psp' },
        { label: 'Create Status Page', id: 'create_psp' },
        { label: 'Update Status Page', id: 'update_psp' },
        { label: 'Delete Status Page', id: 'delete_psp' },
        { label: 'Get Account', id: 'get_account' },
      ],
      value: () => 'list_monitors',
    },

    // Monitor identifier (get/update/delete/pause/start + incident filter)
    {
      id: 'monitorId',
      title: 'Monitor ID',
      type: 'short-input',
      placeholder: 'e.g. 777712345',
      condition: {
        field: 'operation',
        value: [
          'get_monitor',
          'update_monitor',
          'delete_monitor',
          'pause_monitor',
          'start_monitor',
          'list_incidents',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_monitor',
          'update_monitor',
          'delete_monitor',
          'pause_monitor',
          'start_monitor',
        ],
      },
    },

    // Shared name (monitor/psp friendly name + alert contact display name)
    {
      id: 'friendlyName',
      title: 'Friendly Name',
      type: 'short-input',
      placeholder: 'e.g. Production API',
      condition: {
        field: 'operation',
        value: [...MONITOR_EDIT_OPS, ...PSP_EDIT_OPS, 'create_alert_contact'],
      },
      required: { field: 'operation', value: ['create_monitor', 'create_psp'] },
    },

    // Monitor: type
    {
      id: 'type',
      title: 'Monitor Type',
      type: 'dropdown',
      options: [
        { label: 'HTTP(S)', id: 'HTTP' },
        { label: 'Keyword', id: 'KEYWORD' },
        { label: 'Ping', id: 'PING' },
        { label: 'Port', id: 'PORT' },
        { label: 'Heartbeat', id: 'HEARTBEAT' },
        { label: 'DNS', id: 'DNS' },
        { label: 'API', id: 'API' },
        { label: 'UDP', id: 'UDP' },
      ],
      condition: { field: 'operation', value: 'create_monitor' },
      required: { field: 'operation', value: 'create_monitor' },
    },

    // Monitor / list filter: url
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      placeholder: 'e.g. https://example.com',
      condition: { field: 'operation', value: [...MONITOR_EDIT_OPS, 'list_monitors'] },
      required: { field: 'operation', value: 'create_monitor' },
    },

    // Monitor: interval (seconds) — aliased to `interval`
    {
      id: 'monitorInterval',
      title: 'Check Interval (seconds)',
      type: 'short-input',
      placeholder: 'e.g. 300 (minimum 30)',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
      required: { field: 'operation', value: 'create_monitor' },
    },
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: '0-60',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '1-65535 (Port/UDP monitors)',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'keywordType',
      title: 'Keyword Type',
      type: 'dropdown',
      options: [
        { label: 'Alert when keyword exists', id: 'ALERT_EXISTS' },
        { label: 'Alert when keyword does not exist', id: 'ALERT_NOT_EXISTS' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'keywordValue',
      title: 'Keyword Value',
      type: 'short-input',
      placeholder: 'Keyword to look for',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'keywordCaseType',
      title: 'Keyword Case Sensitivity',
      type: 'dropdown',
      options: [
        { label: 'Case-sensitive', id: '0' },
        { label: 'Case-insensitive', id: '1' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'httpMethodType',
      title: 'HTTP Method',
      type: 'dropdown',
      options: [
        { label: 'HEAD', id: 'HEAD' },
        { label: 'GET', id: 'GET' },
        { label: 'POST', id: 'POST' },
        { label: 'PUT', id: 'PUT' },
        { label: 'PATCH', id: 'PATCH' },
        { label: 'DELETE', id: 'DELETE' },
        { label: 'OPTIONS', id: 'OPTIONS' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'authType',
      title: 'Authentication Type',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'NONE' },
        { label: 'HTTP Basic', id: 'HTTP_BASIC' },
        { label: 'Digest', id: 'DIGEST' },
        { label: 'Bearer', id: 'BEARER' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'httpUsername',
      title: 'HTTP Username',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'httpPassword',
      title: 'HTTP Password',
      type: 'short-input',
      password: true,
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'gracePeriod',
      title: 'Grace Period (seconds)',
      type: 'short-input',
      placeholder: '0-86400 (Heartbeat monitors)',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'successHttpResponseCodes',
      title: 'Success HTTP Codes',
      type: 'short-input',
      placeholder: 'e.g. 2xx,3xx',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'checkSSLErrors',
      title: 'Check SSL Errors',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'followRedirections',
      title: 'Follow Redirects',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'sslExpirationReminder',
      title: 'SSL Expiration Reminder',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'domainExpirationReminder',
      title: 'Domain Expiration Reminder',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'responseTimeThreshold',
      title: 'Response Time Threshold (ms)',
      type: 'short-input',
      placeholder: '0-60000',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'tagNames',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag names',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'assignedAlertContacts',
      title: 'Assigned Alert Contacts',
      type: 'long-input',
      placeholder: '[{"alertContactId":123,"threshold":0,"recurrence":0}]',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'customHttpHeaders',
      title: 'Custom HTTP Headers',
      type: 'long-input',
      placeholder: '{"X-Custom-Header":"value"}',
      mode: 'advanced',
      condition: { field: 'operation', value: MONITOR_EDIT_OPS },
    },
    {
      id: 'groupId',
      title: 'Monitor Group ID',
      type: 'short-input',
      placeholder: '0 for no group',
      mode: 'advanced',
      condition: { field: 'operation', value: [...MONITOR_EDIT_OPS, 'list_monitors'] },
    },

    // List monitors filters
    {
      id: 'monitorStatusFilter',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'e.g. UP,DOWN (comma-separated)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_monitors' },
    },
    {
      id: 'tags',
      title: 'Tags Filter',
      type: 'short-input',
      placeholder: 'Comma-separated tags',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_monitors' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '1-200 (default 50)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_monitors' },
    },

    // Shared name (list-monitor filter + maintenance window name)
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Maintenance window name or monitor name filter',
      condition: { field: 'operation', value: ['list_monitors', ...MAINTENANCE_EDIT_OPS] },
      required: { field: 'operation', value: 'create_maintenance_window' },
    },

    // Incident filters / identifier
    {
      id: 'incidentId',
      title: 'Incident ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'get_incident' },
      required: { field: 'operation', value: 'get_incident' },
    },
    {
      id: 'monitorName',
      title: 'Monitor Name Filter',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_incidents' },
    },
    {
      id: 'startedAfter',
      title: 'Started After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_incidents' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp (e.g. 2025-01-01T00:00:00Z). Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'startedBefore',
      title: 'Started Before',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_incidents' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp (e.g. 2025-01-01T00:00:00Z). Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },

    // Maintenance window identifier + fields
    {
      id: 'maintenanceWindowId',
      title: 'Maintenance Window ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_maintenance_window', 'update_maintenance_window', 'delete_maintenance_window'],
      },
      required: {
        field: 'operation',
        value: ['get_maintenance_window', 'update_maintenance_window', 'delete_maintenance_window'],
      },
    },
    {
      id: 'maintenanceInterval',
      title: 'Recurrence',
      type: 'dropdown',
      options: [
        { label: 'Once', id: 'once' },
        { label: 'Daily', id: 'daily' },
        { label: 'Weekly', id: 'weekly' },
        { label: 'Monthly', id: 'monthly' },
      ],
      condition: { field: 'operation', value: MAINTENANCE_EDIT_OPS },
      required: { field: 'operation', value: 'create_maintenance_window' },
    },
    {
      id: 'date',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: MAINTENANCE_EDIT_OPS },
      required: { field: 'operation', value: 'create_maintenance_window' },
    },
    {
      id: 'time',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'HH:mm:ss',
      condition: { field: 'operation', value: MAINTENANCE_EDIT_OPS },
      required: { field: 'operation', value: 'create_maintenance_window' },
    },
    {
      id: 'duration',
      title: 'Duration (minutes)',
      type: 'short-input',
      placeholder: 'e.g. 60',
      condition: { field: 'operation', value: MAINTENANCE_EDIT_OPS },
      required: { field: 'operation', value: 'create_maintenance_window' },
    },
    {
      id: 'days',
      title: 'Days',
      type: 'short-input',
      placeholder: 'Comma-separated (weekly 1-7, monthly day-of-month, -1 = last)',
      mode: 'advanced',
      condition: { field: 'operation', value: MAINTENANCE_EDIT_OPS },
    },
    {
      id: 'autoAddMonitors',
      title: 'Auto-add Monitors',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: MAINTENANCE_EDIT_OPS },
    },
    {
      id: 'maintenanceStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'active' },
        { label: 'Paused', id: 'paused' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_maintenance_window' },
    },

    // Shared monitor IDs (maintenance windows + status pages)
    {
      id: 'monitorIds',
      title: 'Monitor IDs',
      type: 'short-input',
      placeholder: 'Comma-separated monitor IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: [...MAINTENANCE_EDIT_OPS, ...PSP_EDIT_OPS] },
    },

    // Alert contact identifier + fields
    {
      id: 'alertContactId',
      title: 'Alert Contact ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_alert_contact', 'delete_alert_contact'] },
      required: { field: 'operation', value: ['get_alert_contact', 'delete_alert_contact'] },
    },
    {
      id: 'value',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'alerts@example.com',
      condition: { field: 'operation', value: 'create_alert_contact' },
      required: { field: 'operation', value: 'create_alert_contact' },
    },
    {
      id: 'enableNotificationsFor',
      title: 'Notify For',
      type: 'short-input',
      placeholder: '0, 1, 2, or 3',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_alert_contact' },
    },

    // Status page identifier + fields
    {
      id: 'pspId',
      title: 'Status Page ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['get_psp', 'update_psp', 'delete_psp'] },
      required: { field: 'operation', value: ['get_psp', 'update_psp', 'delete_psp'] },
    },
    {
      id: 'pspStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Enabled (published)', id: 'ENABLED' },
        { label: 'Paused (unpublished)', id: 'PAUSED' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    {
      id: 'customDomain',
      title: 'Custom Domain',
      type: 'short-input',
      placeholder: 'status.your-domain.com',
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    {
      id: 'password',
      title: 'Page Password',
      type: 'short-input',
      password: true,
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    {
      id: 'hideUrlLinks',
      title: 'Hide "Powered by" Link',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    {
      id: 'noIndex',
      title: 'Disable Search Indexing',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    // Status page logo (basic upload / advanced reference)
    {
      id: 'logoUpload',
      title: 'Logo',
      type: 'file-upload',
      canonicalParamId: 'logo',
      acceptedTypes: 'image/png,image/jpeg',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    {
      id: 'logoRef',
      title: 'Logo',
      type: 'short-input',
      canonicalParamId: 'logo',
      placeholder: 'Reference an image from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    // Status page icon (basic upload / advanced reference)
    {
      id: 'iconUpload',
      title: 'Icon',
      type: 'file-upload',
      canonicalParamId: 'icon',
      acceptedTypes: 'image/png,image/jpeg',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },
    {
      id: 'iconRef',
      title: 'Icon',
      type: 'short-input',
      canonicalParamId: 'icon',
      placeholder: 'Reference an image from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: PSP_EDIT_OPS },
    },

    // Pagination cursors (aliased to `cursor`)
    {
      id: 'monitorsCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_monitors' },
    },
    {
      id: 'incidentsCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_incidents' },
    },
    {
      id: 'maintenanceCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_maintenance_windows' },
    },
    {
      id: 'alertContactsCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_alert_contacts' },
    },
    {
      id: 'pspsCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_psps' },
    },

    // Credential
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your UptimeRobot API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'uptimerobot_list_monitors',
      'uptimerobot_get_monitor',
      'uptimerobot_create_monitor',
      'uptimerobot_update_monitor',
      'uptimerobot_delete_monitor',
      'uptimerobot_pause_monitor',
      'uptimerobot_start_monitor',
      'uptimerobot_list_incidents',
      'uptimerobot_get_incident',
      'uptimerobot_list_maintenance_windows',
      'uptimerobot_get_maintenance_window',
      'uptimerobot_create_maintenance_window',
      'uptimerobot_update_maintenance_window',
      'uptimerobot_delete_maintenance_window',
      'uptimerobot_list_alert_contacts',
      'uptimerobot_get_alert_contact',
      'uptimerobot_create_alert_contact',
      'uptimerobot_delete_alert_contact',
      'uptimerobot_list_psps',
      'uptimerobot_get_psp',
      'uptimerobot_create_psp',
      'uptimerobot_update_psp',
      'uptimerobot_delete_psp',
      'uptimerobot_get_account',
    ],
    config: {
      tool: (params) => `uptimerobot_${params.operation}`,
      params: (params) => {
        // Operation-scoped subblock ids that map onto a shared canonical param.
        const ALIASES = new Set([
          'monitorInterval',
          'maintenanceInterval',
          'monitorStatusFilter',
          'maintenanceStatus',
          'pspStatus',
          'monitorsCursor',
          'incidentsCursor',
          'maintenanceCursor',
          'alertContactsCursor',
          'pspsCursor',
        ])
        // Numeric tool params that arrive as strings from short-input subblocks.
        const NUMERIC = new Set([
          'monitorId',
          'timeout',
          'port',
          'keywordCaseType',
          'gracePeriod',
          'responseTimeThreshold',
          'groupId',
          'limit',
          'duration',
          'maintenanceWindowId',
          'alertContactId',
          'enableNotificationsFor',
          'pspId',
        ])

        const coerceNumeric = (value: unknown): unknown => {
          const numeric = Number(value)
          return Number.isNaN(numeric) ? value : numeric
        }

        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (ALIASES.has(key) || key === 'logo' || key === 'icon') continue
          if (value === undefined || value === null || value === '') continue
          result[key] = NUMERIC.has(key) ? coerceNumeric(value) : value
        }

        // Collapse aliases onto their canonical tool params. `interval` is numeric
        // for monitors but an enum string for maintenance windows, so coercion is
        // NaN-aware and leaves enum values untouched.
        const intervalAlias = params.monitorInterval ?? params.maintenanceInterval
        if (intervalAlias !== undefined && intervalAlias !== '') {
          result.interval = coerceNumeric(intervalAlias)
        }
        const statusAlias =
          params.monitorStatusFilter ?? params.maintenanceStatus ?? params.pspStatus
        if (statusAlias !== undefined && statusAlias !== '') result.status = statusAlias
        const cursorAlias =
          params.monitorsCursor ??
          params.incidentsCursor ??
          params.maintenanceCursor ??
          params.alertContactsCursor ??
          params.pspsCursor
        if (cursorAlias !== undefined && cursorAlias !== '') result.cursor = cursorAlias

        // Collapse basic/advanced file inputs into single UserFile references.
        const logo = normalizeFileInput(params.logo, { single: true })
        const icon = normalizeFileInput(params.icon, { single: true })
        if (logo) result.logo = logo
        if (icon) result.icon = icon

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'UptimeRobot API key' },
    monitorId: { type: 'number', description: 'Monitor ID' },
    friendlyName: { type: 'string', description: 'Friendly name' },
    type: { type: 'string', description: 'Monitor type' },
    url: { type: 'string', description: 'URL or host (also a list filter)' },
    interval: { type: 'string', description: 'Check interval (seconds) or recurrence' },
    timeout: { type: 'number', description: 'Check timeout in seconds' },
    port: { type: 'number', description: 'Port for Port/UDP monitors' },
    keywordType: { type: 'string', description: 'Keyword match type' },
    keywordValue: { type: 'string', description: 'Keyword to look for' },
    keywordCaseType: { type: 'number', description: 'Keyword case sensitivity (0 or 1)' },
    httpMethodType: { type: 'string', description: 'HTTP method' },
    authType: { type: 'string', description: 'HTTP authentication type' },
    httpUsername: { type: 'string', description: 'HTTP auth username' },
    httpPassword: { type: 'string', description: 'HTTP auth password' },
    gracePeriod: { type: 'number', description: 'Heartbeat grace period in seconds' },
    successHttpResponseCodes: { type: 'string', description: 'Comma-separated success HTTP codes' },
    checkSSLErrors: { type: 'boolean', description: 'Check SSL/domain expiration errors' },
    followRedirections: { type: 'boolean', description: 'Follow redirects' },
    sslExpirationReminder: { type: 'boolean', description: 'SSL expiration reminder' },
    domainExpirationReminder: { type: 'boolean', description: 'Domain expiration reminder' },
    responseTimeThreshold: { type: 'number', description: 'Response time threshold (ms)' },
    tagNames: { type: 'string', description: 'Comma-separated tag names' },
    assignedAlertContacts: { type: 'string', description: 'JSON alert-contact assignments' },
    customHttpHeaders: { type: 'string', description: 'JSON custom HTTP headers' },
    groupId: { type: 'number', description: 'Monitor group ID' },
    status: { type: 'string', description: 'Status filter or value' },
    tags: { type: 'string', description: 'Comma-separated tag filter' },
    limit: { type: 'number', description: 'Results per page' },
    name: { type: 'string', description: 'Maintenance window name or monitor name filter' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    incidentId: { type: 'string', description: 'Incident ID' },
    monitorName: { type: 'string', description: 'Monitor name filter for incidents' },
    startedAfter: { type: 'string', description: 'Incident start lower bound (ISO 8601)' },
    startedBefore: { type: 'string', description: 'Incident start upper bound (ISO 8601)' },
    maintenanceWindowId: { type: 'number', description: 'Maintenance window ID' },
    date: { type: 'string', description: 'Maintenance window start date (YYYY-MM-DD)' },
    time: { type: 'string', description: 'Maintenance window start time (HH:mm:ss)' },
    duration: { type: 'number', description: 'Maintenance window duration (minutes)' },
    days: { type: 'string', description: 'Comma-separated days for recurrence' },
    autoAddMonitors: { type: 'boolean', description: 'Auto-add all monitors' },
    monitorIds: { type: 'string', description: 'Comma-separated monitor IDs' },
    alertContactId: { type: 'number', description: 'Alert contact ID' },
    value: { type: 'string', description: 'Email address for the alert contact' },
    enableNotificationsFor: { type: 'number', description: 'Which monitor events to notify for' },
    pspId: { type: 'number', description: 'Status page ID' },
    customDomain: { type: 'string', description: 'Status page custom domain' },
    password: { type: 'string', description: 'Status page password' },
    hideUrlLinks: { type: 'boolean', description: 'Hide the "Powered by" footer link' },
    noIndex: { type: 'boolean', description: 'Disable search engine indexing' },
    logo: { type: 'string', description: 'Status page logo image' },
    icon: { type: 'string', description: 'Status page icon image' },
  },

  outputs: {
    monitors: { type: 'json', description: 'List of monitors' },
    monitor: { type: 'json', description: 'A single monitor' },
    incidents: { type: 'json', description: 'List of incidents' },
    incident: { type: 'json', description: 'A single incident' },
    maintenanceWindows: { type: 'json', description: 'List of maintenance windows' },
    maintenanceWindow: { type: 'json', description: 'A single maintenance window' },
    alertContacts: { type: 'json', description: 'List of alert contacts' },
    alertContact: { type: 'json', description: 'A single alert contact' },
    psps: { type: 'json', description: 'List of public status pages' },
    psp: { type: 'json', description: 'A single public status page' },
    account: { type: 'json', description: 'Account details' },
    nextLink: { type: 'string', description: 'Pagination link for the next page of results' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    id: { type: 'number', description: 'ID of the deleted resource' },
  },
}

export const UptimeRobotBlockMeta = {
  tags: ['monitoring', 'incident-management', 'automation'],
  url: 'https://uptimerobot.com',
  templates: [
    {
      icon: UptimeRobotIcon,
      title: 'Downtime alert to Slack',
      prompt:
        'Build a scheduled workflow that lists UptimeRobot incidents from the last hour, filters to ones that are still active, and posts a formatted Slack alert with the affected monitor name, cause, and how long it has been down.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'incident-management'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Auto-create monitors from a table',
      prompt:
        'Create a workflow that reads a list of service URLs from a table and creates an HTTP UptimeRobot monitor for each one with a 5-minute interval, then writes the new monitor IDs back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Incident to Linear ticket',
      prompt:
        'Build a scheduled workflow that polls UptimeRobot for active incidents, and for any new incident creates a Linear ticket with the monitor name, cause, and root-cause URL, then posts the ticket link to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident-management'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Maintenance window scheduler',
      prompt:
        'Create a workflow that, before a planned deploy, creates a one-time UptimeRobot maintenance window covering the affected monitors for the next 30 minutes so alerts are suppressed during the rollout.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Daily uptime digest',
      prompt:
        'Build a scheduled daily workflow that lists all UptimeRobot monitors, summarizes how many are up versus down, lists any currently in a down state, and emails a morning availability digest to the on-call team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'reporting'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Status page publisher',
      prompt:
        'Create a workflow that builds a public status page in UptimeRobot for a chosen set of monitors, uploads the company logo, and returns the public URL key so it can be shared.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'communication'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Pause monitors during maintenance',
      prompt:
        'Build a workflow that, when triggered, pauses a specific UptimeRobot monitor, waits for an upstream maintenance task to finish, then starts the monitor again and confirms it is back to a running state.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: UptimeRobotIcon,
      title: 'Onboard alert contacts',
      prompt:
        'Create a workflow that reads a list of team email addresses and adds each one as an UptimeRobot alert contact, then assigns them to the critical production monitors.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
  ],
  skills: [
    {
      name: 'alert-on-active-downtime',
      description:
        'Detect services that are currently down and notify the team. Use to turn UptimeRobot incidents into actionable alerts.',
      content:
        '# Alert On Active Downtime\n\nSurface services that are currently down and notify the team.\n\n## Steps\n1. Use List Incidents (optionally filtered by a recent Started After timestamp) to get recent incidents.\n2. Keep only incidents that are not resolved (no resolvedAt) — these are still active.\n3. For richer context, use Get Incident on each active incident to read its cause, reason, and root-cause URL.\n4. Format an alert with the affected monitor name, how long it has been down (duration), and the cause.\n\n## Output\nReturn a concise alert per active incident: monitor name, started time, duration, and cause. If nothing is active, report that all monitored services are healthy.',
    },
    {
      name: 'create-uptime-monitor',
      description:
        'Add a new HTTP, keyword, ping, or port monitor for a service so it is tracked for uptime. Use when onboarding a new endpoint.',
      content:
        '# Create Uptime Monitor\n\nStart monitoring a new service endpoint.\n\n## Steps\n1. Decide the monitor type (HTTP for most web services, KEYWORD to assert page content, PING/PORT for hosts).\n2. Use Create Monitor with a friendly name, the URL or host, and a check interval in seconds (minimum 30; 300 is a sensible default).\n3. For keyword monitors, also set the keyword type and value. For HTTP, optionally set the method, success codes, and SSL checks.\n4. Confirm the returned monitor id and status.\n\n## Output\nReturn the new monitor id, friendly name, type, and current status. Note the check interval so the user knows how often it runs.',
    },
    {
      name: 'publish-status-page',
      description:
        'Create a public status page for a set of monitors, optionally with a logo, and share the public URL. Use to communicate service health externally.',
      content:
        '# Publish Status Page\n\nStand up a public status page for chosen monitors.\n\n## Steps\n1. Identify the monitor ids to include (use List Monitors if needed).\n2. Use Create Status Page with a friendly name, the comma-separated monitor ids, and status ENABLED to publish it.\n3. Optionally upload a logo and icon image, and set a custom domain or password.\n4. Read the returned urlKey to build the shareable status page link.\n\n## Output\nReturn the status page id, friendly name, status, and the public URL key. Mention whether a logo and custom domain were applied.',
    },
    {
      name: 'schedule-maintenance-window',
      description:
        'Suppress alerts during planned maintenance by creating a maintenance window over the affected monitors. Use before a deploy or migration.',
      content:
        '# Schedule Maintenance Window\n\nSuppress alerts during planned downtime.\n\n## Steps\n1. Use Create Maintenance Window with a name, recurrence (once/daily/weekly/monthly), start date (YYYY-MM-DD), start time (HH:mm:ss), and a duration in minutes.\n2. Assign the affected monitor ids, or enable auto-add monitors.\n3. For one-off maintenance, use recurrence "once".\n4. Optionally pause specific monitors directly with Pause Monitor, then Start Monitor when finished.\n\n## Output\nReturn the maintenance window id, schedule (date/time/duration), and the monitors it covers. Confirm that alerts will be suppressed during the window.',
    },
    {
      name: 'incident-triage-report',
      description:
        'Compile a report of recent incidents with their causes and durations for a postmortem or daily review. Use to summarize reliability.',
      content:
        '# Incident Triage Report\n\nSummarize recent incidents for review.\n\n## Steps\n1. Use List Incidents over the desired time range (set Started After / Started Before).\n2. For each incident, use Get Incident to pull the cause, reason, root-cause URL, and HTTP response code.\n3. Group incidents by monitor and compute total downtime per service from the durations.\n4. Highlight the longest and most frequent outages.\n\n## Output\nReturn a structured report: per-monitor incident counts, total downtime, and the top incidents with cause and duration. Call out any still-active incidents at the top.',
    },
  ],
} as const satisfies BlockMeta
