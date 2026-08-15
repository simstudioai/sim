import type { OutputProperty, ToolOutputProperty } from '@/tools/types'

/**
 * Per-item errors CrowdStrike returns in the standard `{ meta, resources, errors }`
 * envelope. A 200 response with a populated `errors` array is a partial success.
 */
export const CROWDSTRIKE_ERRORS_OUTPUT: ToolOutputProperty = {
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
}

/** Offset/limit pagination metadata from `meta.pagination`. */
export const CROWDSTRIKE_PAGINATION_OUTPUT: ToolOutputProperty = {
  type: 'json',
  description: 'Pagination metadata (limit, offset, total)',
  optional: true,
  properties: {
    limit: { type: 'number', description: 'Page size used for the query', optional: true },
    offset: { type: 'number', description: 'Offset returned by CrowdStrike', optional: true },
    total: { type: 'number', description: 'Total records available', optional: true },
  },
}

/**
 * Documented fields of the CrowdStrike Alerts API alert resource
 * (POST /alerts/entities/alerts/v2).
 */
export const CROWDSTRIKE_ALERT_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
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
  hostname: { type: 'string', description: 'Hostname from the alert device', optional: true },
  name: { type: 'string', description: 'Alert name', optional: true },
  displayName: { type: 'string', description: 'Alert display name', optional: true },
  description: { type: 'string', description: 'Alert description', optional: true },
  type: { type: 'string', description: 'Alert type', optional: true },
  product: { type: 'string', description: 'Falcon product that raised the alert', optional: true },
  platform: { type: 'string', description: 'Platform the alert was raised on', optional: true },
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
  userName: { type: 'string', description: 'User name associated with the alert', optional: true },
  userId: { type: 'string', description: 'User ID associated with the alert', optional: true },
  patternId: { type: 'number', description: 'Detection pattern ID', optional: true },
  falconHostLink: {
    type: 'string',
    description: 'Deep link into the Falcon console',
    optional: true,
  },
  controlGraphId: { type: 'string', description: 'Control graph identifier', optional: true },
  external: { type: 'boolean', description: 'Whether the alert is external', optional: true },
  emailSent: {
    type: 'boolean',
    description: 'Whether a notification email was sent',
    optional: true,
  },
  isAggregated: { type: 'boolean', description: 'Whether the alert is aggregated', optional: true },
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
  createdTimestamp: { type: 'string', description: 'Alert creation timestamp', optional: true },
  updatedTimestamp: { type: 'string', description: 'Alert update timestamp', optional: true },
  crawledTimestamp: { type: 'string', description: 'Alert crawl timestamp', optional: true },
  contextTimestamp: { type: 'string', description: 'Alert context timestamp', optional: true },
}

/**
 * Documented fields of the CrowdStrike host group resource
 * (GET /devices/entities/host-groups/v1).
 */
export const CROWDSTRIKE_HOST_GROUP_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Host group identifier', optional: true },
  name: { type: 'string', description: 'Host group name', optional: true },
  description: { type: 'string', description: 'Host group description', optional: true },
  groupType: {
    type: 'string',
    description: 'Group type (static, dynamic, staticByID)',
    optional: true,
  },
  assignmentRule: {
    type: 'string',
    description: 'FQL assignment rule for dynamic groups',
    optional: true,
  },
  createdBy: { type: 'string', description: 'User who created the group', optional: true },
  createdTimestamp: { type: 'string', description: 'Group creation timestamp', optional: true },
  modifiedBy: { type: 'string', description: 'User who last modified the group', optional: true },
  modifiedTimestamp: {
    type: 'string',
    description: 'Group modification timestamp',
    optional: true,
  },
}

/**
 * Documented fields of the CrowdStrike IOC Management indicator resource
 * (GET /iocs/entities/indicators/v1).
 */
export const CROWDSTRIKE_INDICATOR_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Indicator identifier', optional: true },
  type: { type: 'string', description: 'Indicator type', optional: true },
  value: { type: 'string', description: 'Indicator value', optional: true },
  action: {
    type: 'string',
    description: 'Action taken when the indicator matches',
    optional: true,
  },
  mobileAction: {
    type: 'string',
    description: 'Action taken on mobile platforms when the indicator matches',
    optional: true,
  },
  severity: { type: 'string', description: 'Indicator severity', optional: true },
  description: { type: 'string', description: 'Indicator description', optional: true },
  source: { type: 'string', description: 'Indicator source', optional: true },
  appliedGlobally: {
    type: 'boolean',
    description: 'Whether the indicator applies to all hosts',
    optional: true,
  },
  platforms: {
    type: 'array',
    description: 'Platforms the indicator applies to',
    optional: true,
    items: { type: 'string' },
  },
  hostGroups: {
    type: 'array',
    description: 'Host group IDs the indicator is scoped to',
    optional: true,
    items: { type: 'string' },
  },
  tags: {
    type: 'array',
    description: 'Tags applied to the indicator',
    optional: true,
    items: { type: 'string' },
  },
  expiration: { type: 'string', description: 'Indicator expiration timestamp', optional: true },
  expired: { type: 'boolean', description: 'Whether the indicator has expired', optional: true },
  deleted: { type: 'boolean', description: 'Whether the indicator is deleted', optional: true },
  fromParent: {
    type: 'boolean',
    description: 'Whether the indicator was inherited from a parent CID',
    optional: true,
  },
  parentCidName: { type: 'string', description: 'Parent CID name', optional: true },
  createdBy: { type: 'string', description: 'User who created the indicator', optional: true },
  createdOn: { type: 'string', description: 'Indicator creation timestamp', optional: true },
  modifiedBy: {
    type: 'string',
    description: 'User who last modified the indicator',
    optional: true,
  },
  modifiedOn: { type: 'string', description: 'Indicator modification timestamp', optional: true },
  metadata: {
    type: 'json',
    description: 'File metadata CrowdStrike resolved for the indicator',
    optional: true,
    properties: {
      avHits: { type: 'number', description: 'Antivirus hit count', optional: true },
      companyName: { type: 'string', description: 'Company name', optional: true },
      fileDescription: { type: 'string', description: 'File description', optional: true },
      fileVersion: { type: 'string', description: 'File version', optional: true },
      filename: { type: 'string', description: 'File name', optional: true },
      originalFilename: { type: 'string', description: 'Original file name', optional: true },
      productName: { type: 'string', description: 'Product name', optional: true },
      productVersion: { type: 'string', description: 'Product version', optional: true },
      signed: { type: 'boolean', description: 'Whether the file is signed', optional: true },
    },
  },
}

/**
 * Documented fields of the CrowdStrike Spotlight vulnerability resource
 * (GET /spotlight/entities/vulnerabilities/v2).
 */
export const CROWDSTRIKE_VULNERABILITY_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Vulnerability identifier', optional: true },
  aid: { type: 'string', description: 'Agent identifier of the affected host', optional: true },
  cid: { type: 'string', description: 'CrowdStrike customer identifier', optional: true },
  status: {
    type: 'string',
    description: 'Vulnerability status (open, closed, reopen)',
    optional: true,
  },
  confidence: { type: 'string', description: 'Detection confidence', optional: true },
  vulnerabilityId: { type: 'string', description: 'Underlying vulnerability ID', optional: true },
  createdTimestamp: { type: 'string', description: 'Creation timestamp', optional: true },
  updatedTimestamp: { type: 'string', description: 'Last update timestamp', optional: true },
  closedTimestamp: { type: 'string', description: 'Closure timestamp', optional: true },
  cve: {
    type: 'json',
    description: 'CVE details for the vulnerability',
    optional: true,
    properties: {
      id: { type: 'string', description: 'CVE identifier', optional: true },
      baseScore: { type: 'number', description: 'CVSS base score', optional: true },
      severity: { type: 'string', description: 'CVE severity', optional: true },
      exprtRating: { type: 'string', description: 'CrowdStrike ExPRT rating', optional: true },
      exploitStatus: { type: 'number', description: 'Exploit status code', optional: true },
      exploitabilityScore: {
        type: 'number',
        description: 'CVSS exploitability score',
        optional: true,
      },
      impactScore: { type: 'number', description: 'CVSS impact score', optional: true },
      remediationLevel: { type: 'string', description: 'CVSS remediation level', optional: true },
      description: { type: 'string', description: 'CVE description', optional: true },
      publishedDate: { type: 'string', description: 'CVE publication date', optional: true },
      vector: { type: 'string', description: 'CVSS vector string', optional: true },
      types: {
        type: 'array',
        description: 'CVE types',
        optional: true,
        items: { type: 'string' },
      },
      isCisaKev: {
        type: 'boolean',
        description: 'Whether the CVE is in the CISA Known Exploited Vulnerabilities catalog',
        optional: true,
      },
      cisaDueDate: { type: 'string', description: 'CISA remediation due date', optional: true },
    },
  },
  app: {
    type: 'json',
    description: 'Affected application',
    optional: true,
    properties: {
      productNameNormalized: {
        type: 'string',
        description: 'Normalized product name',
        optional: true,
      },
      productNameVersion: {
        type: 'string',
        description: 'Product name and version',
        optional: true,
      },
      vendorNormalized: { type: 'string', description: 'Normalized vendor name', optional: true },
    },
  },
  hostInfo: {
    type: 'json',
    description: 'Affected host details',
    optional: true,
    properties: {
      hostname: { type: 'string', description: 'Host name', optional: true },
      localIp: { type: 'string', description: 'Local IP address', optional: true },
      machineDomain: { type: 'string', description: 'Machine domain', optional: true },
      osVersion: { type: 'string', description: 'Operating system version', optional: true },
      platform: { type: 'string', description: 'Platform name', optional: true },
      productTypeDesc: { type: 'string', description: 'Product type description', optional: true },
      assetCriticality: { type: 'string', description: 'Asset criticality', optional: true },
      internetExposure: { type: 'string', description: 'Internet exposure', optional: true },
      tags: {
        type: 'array',
        description: 'Host tags',
        optional: true,
        items: { type: 'string' },
      },
      groups: {
        type: 'array',
        description: 'Host group names the host belongs to',
        optional: true,
        items: { type: 'string' },
      },
    },
  },
  remediationIds: {
    type: 'array',
    description: 'Remediation IDs for the vulnerability',
    optional: true,
    items: { type: 'string' },
  },
  remediations: {
    type: 'array',
    description: 'Remediation entities for the vulnerability',
    optional: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Remediation identifier', optional: true },
        title: { type: 'string', description: 'Remediation title', optional: true },
        action: { type: 'string', description: 'Remediation action', optional: true },
        type: { type: 'string', description: 'Remediation type', optional: true },
        link: { type: 'string', description: 'Remediation link', optional: true },
        reference: { type: 'string', description: 'Remediation reference', optional: true },
        vendorUrl: { type: 'string', description: 'Vendor advisory URL', optional: true },
      },
    },
  },
  suppressionInfo: {
    type: 'json',
    description: 'Suppression state for the vulnerability',
    optional: true,
    properties: {
      isSuppressed: {
        type: 'boolean',
        description: 'Whether the finding is suppressed',
        optional: true,
      },
      reason: { type: 'string', description: 'Suppression reason', optional: true },
    },
  },
}

const CROWDSTRIKE_FALCON_USER_PROPERTIES: Record<string, OutputProperty> = {
  uuid: { type: 'string', description: 'Falcon user UUID', optional: true },
  email: { type: 'string', description: 'Falcon user email', optional: true },
  fullName: { type: 'string', description: 'Falcon user full name', optional: true },
}

/**
 * Documented fields of the CrowdStrike Case Management case resource
 * (POST /cases/entities/cases/v2).
 */
export const CROWDSTRIKE_CASE_OUTPUT_PROPERTIES: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Case identifier', optional: true },
  cid: { type: 'string', description: 'CrowdStrike customer identifier', optional: true },
  name: { type: 'string', description: 'Case name', optional: true },
  description: { type: 'string', description: 'Case description', optional: true },
  descriptionFormat: {
    type: 'string',
    description: 'Format of the case description',
    optional: true,
  },
  status: { type: 'string', description: 'Case status', optional: true },
  severity: { type: 'number', description: 'Numeric case severity', optional: true },
  severityLevel: { type: 'string', description: 'Case severity level name', optional: true },
  referenceId: { type: 'string', description: 'Human-readable case reference ID', optional: true },
  version: {
    type: 'number',
    description: 'Case version for optimistic concurrency',
    optional: true,
  },
  tags: {
    type: 'array',
    description: 'Tags applied to the case',
    optional: true,
    items: { type: 'string' },
  },
  assignedTo: {
    type: 'json',
    description: 'Falcon user the case is assigned to',
    optional: true,
    properties: CROWDSTRIKE_FALCON_USER_PROPERTIES,
  },
  createdBy: {
    type: 'json',
    description: 'Falcon user who created the case',
    optional: true,
    properties: CROWDSTRIKE_FALCON_USER_PROPERTIES,
  },
  lastUpdatedBy: {
    type: 'json',
    description: 'Falcon user who last updated the case',
    optional: true,
    properties: CROWDSTRIKE_FALCON_USER_PROPERTIES,
  },
  createdTimestamp: { type: 'string', description: 'Case creation timestamp', optional: true },
  updatedTimestamp: { type: 'string', description: 'Case update timestamp', optional: true },
  startTimestamp: { type: 'string', description: 'Case start timestamp', optional: true },
  endTimestamp: { type: 'string', description: 'Case end timestamp', optional: true },
  templateId: { type: 'string', description: 'Case template identifier', optional: true },
  templateName: { type: 'string', description: 'Case template name', optional: true },
  slaId: { type: 'string', description: 'SLA identifier applied to the case', optional: true },
  slaName: { type: 'string', description: 'SLA name applied to the case', optional: true },
  isReadOnly: { type: 'boolean', description: 'Whether the case is read only', optional: true },
}

/** Affected-entity resources returned by CrowdStrike action endpoints. */
export const CROWDSTRIKE_AFFECTED_ENTITIES_OUTPUT: ToolOutputProperty = {
  type: 'array',
  description: 'Entities affected by the action',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Affected entity identifier', optional: true },
      path: { type: 'string', description: 'API path of the affected entity', optional: true },
    },
  },
}
