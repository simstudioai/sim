import type {
  CrowdStrikeGetAlertDetailsParams,
  CrowdStrikeGetAlertDetailsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetAlertDetailsTool: ToolConfig<
  CrowdStrikeGetAlertDetailsParams,
  CrowdStrikeGetAlertDetailsResponse
> = {
  id: 'crowdstrike_get_alert_details',
  name: 'CrowdStrike Get Alert Details',
  description:
    'Get full CrowdStrike Falcon alert records for one or more composite alert IDs (POST /alerts/entities/alerts/v2). Requires the "Alerts: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    compositeIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of CrowdStrike composite alert IDs',
    },
    includeHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include previously hidden alerts (CrowdStrike defaults this to true)',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      compositeIds: params.compositeIds,
      includeHidden: params.includeHidden,
      operation: 'crowdstrike_get_alert_details',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike alert details')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    alerts: {
      type: 'array',
      description: 'CrowdStrike alert records',
      items: {
        type: 'object',
        properties: {
          compositeId: { type: 'string', description: 'Composite alert ID', optional: true },
          id: { type: 'string', description: 'Alert ID', optional: true },
          cid: { type: 'string', description: 'CrowdStrike customer identifier', optional: true },
          aggregateId: { type: 'string', description: 'Aggregate identifier', optional: true },
          agentId: { type: 'string', description: 'Agent (sensor) identifier', optional: true },
          deviceId: {
            type: 'string',
            description: 'Device identifier from the alert device',
            optional: true,
          },
          hostname: {
            type: 'string',
            description: 'Hostname from the alert device',
            optional: true,
          },
          name: { type: 'string', description: 'Alert name', optional: true },
          displayName: { type: 'string', description: 'Alert display name', optional: true },
          description: { type: 'string', description: 'Alert description', optional: true },
          type: { type: 'string', description: 'Alert type', optional: true },
          product: {
            type: 'string',
            description: 'Falcon product that raised the alert',
            optional: true,
          },
          platform: {
            type: 'string',
            description: 'Platform the alert was raised on',
            optional: true,
          },
          severity: { type: 'number', description: 'Numeric severity', optional: true },
          severityName: { type: 'string', description: 'Severity name', optional: true },
          confidence: { type: 'number', description: 'Confidence score', optional: true },
          status: { type: 'string', description: 'Alert status', optional: true },
          assignedToName: { type: 'string', description: 'Assignee display name', optional: true },
          assignedToUid: { type: 'string', description: 'Assignee user ID', optional: true },
          assignedToUuid: { type: 'string', description: 'Assignee user UUID', optional: true },
          tactic: { type: 'string', description: 'MITRE ATT&CK tactic', optional: true },
          tacticId: { type: 'string', description: 'MITRE ATT&CK tactic ID', optional: true },
          technique: { type: 'string', description: 'MITRE ATT&CK technique', optional: true },
          techniqueId: { type: 'string', description: 'MITRE ATT&CK technique ID', optional: true },
          scenario: { type: 'string', description: 'Alert scenario', optional: true },
          objective: { type: 'string', description: 'Adversary objective', optional: true },
          resolution: { type: 'string', description: 'Alert resolution', optional: true },
          showInUi: {
            type: 'boolean',
            description: 'Whether the alert is shown in Falcon',
            optional: true,
          },
          tags: {
            type: 'array',
            description: 'Tags applied to the alert',
            optional: true,
            items: { type: 'string' },
          },
          filename: { type: 'string', description: 'Triggering file name', optional: true },
          filepath: { type: 'string', description: 'Triggering file path', optional: true },
          cmdline: { type: 'string', description: 'Triggering command line', optional: true },
          sha256: { type: 'string', description: 'SHA256 of the triggering file', optional: true },
          sha1: { type: 'string', description: 'SHA1 of the triggering file', optional: true },
          md5: { type: 'string', description: 'MD5 of the triggering file', optional: true },
          userName: {
            type: 'string',
            description: 'User name associated with the alert',
            optional: true,
          },
          userId: {
            type: 'string',
            description: 'User ID associated with the alert',
            optional: true,
          },
          patternId: { type: 'number', description: 'Detection pattern ID', optional: true },
          falconHostLink: {
            type: 'string',
            description: 'Deep link into the Falcon console',
            optional: true,
          },
          controlGraphId: {
            type: 'string',
            description: 'Control graph identifier',
            optional: true,
          },
          external: {
            type: 'boolean',
            description: 'Whether the alert is external',
            optional: true,
          },
          emailSent: {
            type: 'boolean',
            description: 'Whether a notification email was sent',
            optional: true,
          },
          isAggregated: {
            type: 'boolean',
            description: 'Whether the alert is aggregated',
            optional: true,
          },
          isFalconPlatformIoa: {
            type: 'boolean',
            description: 'Whether the alert is a Falcon platform IOA',
            optional: true,
          },
          dataDomains: {
            type: 'array',
            description: 'Data domains the alert belongs to',
            optional: true,
            items: { type: 'string' },
          },
          iocValues: {
            type: 'array',
            description: 'Indicator values associated with the alert',
            optional: true,
            items: { type: 'string' },
          },
          linkedCaseIds: {
            type: 'array',
            description: 'Case IDs linked to the alert',
            optional: true,
            items: { type: 'string' },
          },
          linkedBehavioralDetections: {
            type: 'array',
            description: 'Behavioral detection IDs linked to the alert',
            optional: true,
            items: { type: 'string' },
          },
          timestamp: { type: 'string', description: 'Alert timestamp', optional: true },
          createdTimestamp: {
            type: 'string',
            description: 'Alert creation timestamp',
            optional: true,
          },
          updatedTimestamp: {
            type: 'string',
            description: 'Alert update timestamp',
            optional: true,
          },
          crawledTimestamp: {
            type: 'string',
            description: 'Alert crawl timestamp',
            optional: true,
          },
          contextTimestamp: {
            type: 'string',
            description: 'Alert context timestamp',
            optional: true,
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of alerts returned',
    },
    errors: {
      type: 'array',
      description: 'Errors CrowdStrike returned alongside a partially successful response',
      optional: true,
      items: {
        type: 'object',
        properties: {
          code: { type: 'number', description: 'CrowdStrike error code', optional: true },
          id: { type: 'string', description: 'Identifier the error applies to', optional: true },
          message: { type: 'string', description: 'Error message', optional: true },
        },
      },
    },
  },
}
