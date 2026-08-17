import {
  getBoolean,
  getNumber,
  getRecord,
  getRecordArray,
  getString,
  getStringArray,
  type JsonRecord,
} from '@/app/api/tools/crowdstrike/query/falcon'
import type {
  CrowdStrikeAffectedEntity,
  CrowdStrikeAlert,
  CrowdStrikeCase,
  CrowdStrikeFalconUser,
  CrowdStrikeHostGroup,
  CrowdStrikeIndicator,
  CrowdStrikeVulnerability,
} from '@/tools/crowdstrike/types'

export function normalizeAlert(resource: JsonRecord): CrowdStrikeAlert {
  const device = getRecord(resource.device)

  return {
    compositeId: getString(resource.composite_id),
    id: getString(resource.id),
    cid: getString(resource.cid),
    aggregateId: getString(resource.aggregate_id),
    agentId: getString(resource.agent_id),
    deviceId: device ? getString(device.device_id) : null,
    hostname: device ? getString(device.hostname) : null,
    name: getString(resource.name),
    displayName: getString(resource.display_name),
    description: getString(resource.description),
    type: getString(resource.type),
    product: getString(resource.product),
    platform: getString(resource.platform),
    severity: getNumber(resource.severity),
    severityName: getString(resource.severity_name),
    confidence: getNumber(resource.confidence),
    status: getString(resource.status),
    assignedToName: getString(resource.assigned_to_name),
    assignedToUid: getString(resource.assigned_to_uid),
    assignedToUuid: getString(resource.assigned_to_uuid),
    tactic: getString(resource.tactic),
    tacticId: getString(resource.tactic_id),
    technique: getString(resource.technique),
    techniqueId: getString(resource.technique_id),
    scenario: getString(resource.scenario),
    objective: getString(resource.objective),
    resolution: getString(resource.resolution),
    showInUi: getBoolean(resource.show_in_ui),
    tags: getStringArray(resource.tags),
    filename: getString(resource.filename),
    filepath: getString(resource.filepath),
    cmdline: getString(resource.cmdline),
    sha256: getString(resource.sha256),
    sha1: getString(resource.sha1),
    md5: getString(resource.md5),
    userName: getString(resource.user_name),
    userId: getString(resource.user_id),
    patternId: getNumber(resource.pattern_id),
    falconHostLink: getString(resource.falcon_host_link),
    controlGraphId: getString(resource.control_graph_id),
    external: getBoolean(resource.external),
    emailSent: getBoolean(resource.email_sent),
    isAggregated: getBoolean(resource.is_aggregated),
    isFalconPlatformIoa: getBoolean(resource.is_falcon_platform_ioa),
    dataDomains: getStringArray(resource.data_domains),
    iocValues: getStringArray(resource.ioc_values),
    linkedCaseIds: getStringArray(resource.linked_case_ids),
    linkedBehavioralDetections: getStringArray(resource.linked_behavioral_detections),
    timestamp: getString(resource.timestamp),
    createdTimestamp: getString(resource.created_timestamp),
    updatedTimestamp: getString(resource.updated_timestamp),
    crawledTimestamp: getString(resource.crawled_timestamp),
    contextTimestamp: getString(resource.context_timestamp),
  }
}

export function normalizeAffectedEntity(resource: JsonRecord): CrowdStrikeAffectedEntity {
  return {
    id: getString(resource.id),
    path: getString(resource.path),
  }
}

export function normalizeHostGroup(resource: JsonRecord): CrowdStrikeHostGroup {
  return {
    id: getString(resource.id),
    name: getString(resource.name),
    description: getString(resource.description),
    groupType: getString(resource.group_type),
    assignmentRule: getString(resource.assignment_rule),
    createdBy: getString(resource.created_by),
    createdTimestamp: getString(resource.created_timestamp),
    modifiedBy: getString(resource.modified_by),
    modifiedTimestamp: getString(resource.modified_timestamp),
  }
}

export function normalizeIndicator(resource: JsonRecord): CrowdStrikeIndicator {
  const metadata = getRecord(resource.metadata)

  return {
    id: getString(resource.id),
    type: getString(resource.type),
    value: getString(resource.value),
    action: getString(resource.action),
    mobileAction: getString(resource.mobile_action),
    severity: getString(resource.severity),
    description: getString(resource.description),
    source: getString(resource.source),
    appliedGlobally: getBoolean(resource.applied_globally),
    platforms: getStringArray(resource.platforms),
    hostGroups: getStringArray(resource.host_groups),
    tags: getStringArray(resource.tags),
    expiration: getString(resource.expiration),
    expired: getBoolean(resource.expired),
    deleted: getBoolean(resource.deleted),
    fromParent: getBoolean(resource.from_parent),
    parentCidName: getString(resource.parent_cid_name),
    createdBy: getString(resource.created_by),
    createdOn: getString(resource.created_on),
    modifiedBy: getString(resource.modified_by),
    modifiedOn: getString(resource.modified_on),
    metadata: metadata
      ? {
          avHits: getNumber(metadata.av_hits),
          companyName: getString(metadata.company_name),
          fileDescription: getString(metadata.file_description),
          fileVersion: getString(metadata.file_version),
          filename: getString(metadata.filename),
          originalFilename: getString(metadata.original_filename),
          productName: getString(metadata.product_name),
          productVersion: getString(metadata.product_version),
          signed: getBoolean(metadata.signed),
        }
      : null,
  }
}

export function normalizeVulnerability(resource: JsonRecord): CrowdStrikeVulnerability {
  const cve = getRecord(resource.cve)
  const cisaInfo = cve ? getRecord(cve.cisa_info) : null
  const app = getRecord(resource.app)
  const hostInfo = getRecord(resource.host_info)
  const remediation = getRecord(resource.remediation)
  const suppressionInfo = getRecord(resource.suppression_info)

  return {
    id: getString(resource.id),
    aid: getString(resource.aid),
    cid: getString(resource.cid),
    status: getString(resource.status),
    confidence: getString(resource.confidence),
    vulnerabilityId: getString(resource.vulnerability_id),
    createdTimestamp: getString(resource.created_timestamp),
    updatedTimestamp: getString(resource.updated_timestamp),
    closedTimestamp: getString(resource.closed_timestamp),
    cve: cve
      ? {
          id: getString(cve.id),
          baseScore: getNumber(cve.base_score),
          severity: getString(cve.severity),
          exprtRating: getString(cve.exprt_rating),
          exploitStatus: getNumber(cve.exploit_status),
          exploitabilityScore: getNumber(cve.exploitability_score),
          impactScore: getNumber(cve.impact_score),
          remediationLevel: getString(cve.remediation_level),
          description: getString(cve.description),
          publishedDate: getString(cve.published_date),
          vector: getString(cve.vector),
          types: getStringArray(cve.types),
          isCisaKev: cisaInfo ? getBoolean(cisaInfo.is_cisa_kev) : null,
          cisaDueDate: cisaInfo ? getString(cisaInfo.due_date) : null,
        }
      : null,
    app: app
      ? {
          productNameNormalized: getString(app.product_name_normalized),
          productNameVersion: getString(app.product_name_version),
          vendorNormalized: getString(app.vendor_normalized),
        }
      : null,
    hostInfo: hostInfo
      ? {
          hostname: getString(hostInfo.hostname),
          localIp: getString(hostInfo.local_ip),
          machineDomain: getString(hostInfo.machine_domain),
          osVersion: getString(hostInfo.os_version),
          platform: getString(hostInfo.platform),
          productTypeDesc: getString(hostInfo.product_type_desc),
          assetCriticality: getString(hostInfo.asset_criticality),
          internetExposure: getString(hostInfo.internet_exposure),
          tags: getStringArray(hostInfo.tags),
          groups: getRecordArray(hostInfo.groups)
            .map((group) => getString(group.name))
            .filter((name): name is string => name !== null),
        }
      : null,
    remediationIds: remediation ? getStringArray(remediation.ids) : [],
    remediations: remediation
      ? getRecordArray(remediation.entities).map((entity) => ({
          id: getString(entity.id),
          title: getString(entity.title),
          action: getString(entity.action),
          type: getString(entity.type),
          link: getString(entity.link),
          reference: getString(entity.reference),
          vendorUrl: getString(entity.vendor_url),
        }))
      : [],
    suppressionInfo: suppressionInfo
      ? {
          isSuppressed: getBoolean(suppressionInfo.is_suppressed),
          reason: getString(suppressionInfo.reason),
        }
      : null,
  }
}

function normalizeFalconUser(value: unknown): CrowdStrikeFalconUser | null {
  const user = getRecord(value)
  if (!user) {
    return null
  }

  return {
    uuid: getString(user.uuid),
    email: getString(user.email),
    fullName: getString(user.full_name),
  }
}

export function normalizeCase(resource: JsonRecord): CrowdStrikeCase {
  const severityInfo = getRecord(resource.severity_info)
  const template = getRecord(resource.template)
  const sla = getRecord(resource.sla)
  const readOnly = getRecord(resource.read_only)

  return {
    id: getString(resource.id),
    cid: getString(resource.cid),
    name: getString(resource.name),
    description: getString(resource.description),
    descriptionFormat: getString(resource.description_format),
    status: getString(resource.status),
    severity: getNumber(resource.severity),
    severityLevel: severityInfo ? getString(severityInfo.level) : null,
    referenceId: getString(resource.reference_id),
    version: getNumber(resource.version),
    tags: getStringArray(resource.tags),
    assignedTo: normalizeFalconUser(resource.assigned_to),
    createdBy: normalizeFalconUser(resource.created_by),
    lastUpdatedBy: normalizeFalconUser(resource.last_updated_by),
    createdTimestamp: getString(resource.created_timestamp),
    updatedTimestamp: getString(resource.updated_timestamp),
    startTimestamp: getString(resource.start_timestamp),
    endTimestamp: getString(resource.end_timestamp),
    templateId: template ? getString(template.id) : null,
    templateName: template ? getString(template.name) : null,
    slaId: sla ? getString(sla.id) : null,
    slaName: sla ? getString(sla.name) : null,
    isReadOnly: readOnly ? getBoolean(readOnly.is_read_only) : null,
  }
}
