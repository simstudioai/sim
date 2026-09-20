import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import {
  getRecord,
  getRecordArray,
  getStringArray,
  type JsonRecord,
} from '@/lib/internal/crowdstrike/client'
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
    compositeId: toStringOrNull(resource.composite_id),
    id: toStringOrNull(resource.id),
    cid: toStringOrNull(resource.cid),
    aggregateId: toStringOrNull(resource.aggregate_id),
    agentId: toStringOrNull(resource.agent_id),
    deviceId: device ? toStringOrNull(device.device_id) : null,
    hostname: device ? toStringOrNull(device.hostname) : null,
    name: toStringOrNull(resource.name),
    displayName: toStringOrNull(resource.display_name),
    description: toStringOrNull(resource.description),
    type: toStringOrNull(resource.type),
    product: toStringOrNull(resource.product),
    platform: toStringOrNull(resource.platform),
    severity: toNumberOrNull(resource.severity),
    severityName: toStringOrNull(resource.severity_name),
    confidence: toNumberOrNull(resource.confidence),
    status: toStringOrNull(resource.status),
    assignedToName: toStringOrNull(resource.assigned_to_name),
    assignedToUid: toStringOrNull(resource.assigned_to_uid),
    assignedToUuid: toStringOrNull(resource.assigned_to_uuid),
    tactic: toStringOrNull(resource.tactic),
    tacticId: toStringOrNull(resource.tactic_id),
    technique: toStringOrNull(resource.technique),
    techniqueId: toStringOrNull(resource.technique_id),
    scenario: toStringOrNull(resource.scenario),
    objective: toStringOrNull(resource.objective),
    resolution: toStringOrNull(resource.resolution),
    showInUi: toBooleanOrNull(resource.show_in_ui),
    tags: getStringArray(resource.tags),
    filename: toStringOrNull(resource.filename),
    filepath: toStringOrNull(resource.filepath),
    cmdline: toStringOrNull(resource.cmdline),
    sha256: toStringOrNull(resource.sha256),
    sha1: toStringOrNull(resource.sha1),
    md5: toStringOrNull(resource.md5),
    userName: toStringOrNull(resource.user_name),
    userId: toStringOrNull(resource.user_id),
    patternId: toNumberOrNull(resource.pattern_id),
    falconHostLink: toStringOrNull(resource.falcon_host_link),
    controlGraphId: toStringOrNull(resource.control_graph_id),
    external: toBooleanOrNull(resource.external),
    emailSent: toBooleanOrNull(resource.email_sent),
    isAggregated: toBooleanOrNull(resource.is_aggregated),
    isFalconPlatformIoa: toBooleanOrNull(resource.is_falcon_platform_ioa),
    dataDomains: getStringArray(resource.data_domains),
    iocValues: getStringArray(resource.ioc_values),
    linkedCaseIds: getStringArray(resource.linked_case_ids),
    linkedBehavioralDetections: getStringArray(resource.linked_behavioral_detections),
    timestamp: toStringOrNull(resource.timestamp),
    createdTimestamp: toStringOrNull(resource.created_timestamp),
    updatedTimestamp: toStringOrNull(resource.updated_timestamp),
    crawledTimestamp: toStringOrNull(resource.crawled_timestamp),
    contextTimestamp: toStringOrNull(resource.context_timestamp),
  }
}

export function normalizeAffectedEntity(resource: JsonRecord): CrowdStrikeAffectedEntity {
  return {
    id: toStringOrNull(resource.id),
    path: toStringOrNull(resource.path),
  }
}

export function normalizeHostGroup(resource: JsonRecord): CrowdStrikeHostGroup {
  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
    groupType: toStringOrNull(resource.group_type),
    assignmentRule: toStringOrNull(resource.assignment_rule),
    createdBy: toStringOrNull(resource.created_by),
    createdTimestamp: toStringOrNull(resource.created_timestamp),
    modifiedBy: toStringOrNull(resource.modified_by),
    modifiedTimestamp: toStringOrNull(resource.modified_timestamp),
  }
}

export function normalizeIndicator(resource: JsonRecord): CrowdStrikeIndicator {
  const metadata = getRecord(resource.metadata)

  return {
    id: toStringOrNull(resource.id),
    type: toStringOrNull(resource.type),
    value: toStringOrNull(resource.value),
    action: toStringOrNull(resource.action),
    mobileAction: toStringOrNull(resource.mobile_action),
    severity: toStringOrNull(resource.severity),
    description: toStringOrNull(resource.description),
    source: toStringOrNull(resource.source),
    appliedGlobally: toBooleanOrNull(resource.applied_globally),
    platforms: getStringArray(resource.platforms),
    hostGroups: getStringArray(resource.host_groups),
    tags: getStringArray(resource.tags),
    expiration: toStringOrNull(resource.expiration),
    expired: toBooleanOrNull(resource.expired),
    deleted: toBooleanOrNull(resource.deleted),
    fromParent: toBooleanOrNull(resource.from_parent),
    parentCidName: toStringOrNull(resource.parent_cid_name),
    createdBy: toStringOrNull(resource.created_by),
    createdOn: toStringOrNull(resource.created_on),
    modifiedBy: toStringOrNull(resource.modified_by),
    modifiedOn: toStringOrNull(resource.modified_on),
    metadata: metadata
      ? {
          avHits: toNumberOrNull(metadata.av_hits),
          companyName: toStringOrNull(metadata.company_name),
          fileDescription: toStringOrNull(metadata.file_description),
          fileVersion: toStringOrNull(metadata.file_version),
          filename: toStringOrNull(metadata.filename),
          originalFilename: toStringOrNull(metadata.original_filename),
          productName: toStringOrNull(metadata.product_name),
          productVersion: toStringOrNull(metadata.product_version),
          signed: toBooleanOrNull(metadata.signed),
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
    id: toStringOrNull(resource.id),
    aid: toStringOrNull(resource.aid),
    cid: toStringOrNull(resource.cid),
    status: toStringOrNull(resource.status),
    confidence: toStringOrNull(resource.confidence),
    vulnerabilityId: toStringOrNull(resource.vulnerability_id),
    createdTimestamp: toStringOrNull(resource.created_timestamp),
    updatedTimestamp: toStringOrNull(resource.updated_timestamp),
    closedTimestamp: toStringOrNull(resource.closed_timestamp),
    cve: cve
      ? {
          id: toStringOrNull(cve.id),
          baseScore: toNumberOrNull(cve.base_score),
          severity: toStringOrNull(cve.severity),
          exprtRating: toStringOrNull(cve.exprt_rating),
          exploitStatus: toNumberOrNull(cve.exploit_status),
          exploitabilityScore: toNumberOrNull(cve.exploitability_score),
          impactScore: toNumberOrNull(cve.impact_score),
          remediationLevel: toStringOrNull(cve.remediation_level),
          description: toStringOrNull(cve.description),
          publishedDate: toStringOrNull(cve.published_date),
          vector: toStringOrNull(cve.vector),
          types: getStringArray(cve.types),
          isCisaKev: cisaInfo ? toBooleanOrNull(cisaInfo.is_cisa_kev) : null,
          cisaDueDate: cisaInfo ? toStringOrNull(cisaInfo.due_date) : null,
        }
      : null,
    app: app
      ? {
          productNameNormalized: toStringOrNull(app.product_name_normalized),
          productNameVersion: toStringOrNull(app.product_name_version),
          vendorNormalized: toStringOrNull(app.vendor_normalized),
        }
      : null,
    hostInfo: hostInfo
      ? {
          hostname: toStringOrNull(hostInfo.hostname),
          localIp: toStringOrNull(hostInfo.local_ip),
          machineDomain: toStringOrNull(hostInfo.machine_domain),
          osVersion: toStringOrNull(hostInfo.os_version),
          platform: toStringOrNull(hostInfo.platform),
          productTypeDesc: toStringOrNull(hostInfo.product_type_desc),
          assetCriticality: toStringOrNull(hostInfo.asset_criticality),
          internetExposure: toStringOrNull(hostInfo.internet_exposure),
          tags: getStringArray(hostInfo.tags),
          groups: getRecordArray(hostInfo.groups)
            .map((group) => toStringOrNull(group.name))
            .filter((name): name is string => name !== null),
        }
      : null,
    remediationIds: remediation ? getStringArray(remediation.ids) : [],
    remediations: remediation
      ? getRecordArray(remediation.entities).map((entity) => ({
          id: toStringOrNull(entity.id),
          title: toStringOrNull(entity.title),
          action: toStringOrNull(entity.action),
          type: toStringOrNull(entity.type),
          link: toStringOrNull(entity.link),
          reference: toStringOrNull(entity.reference),
          vendorUrl: toStringOrNull(entity.vendor_url),
        }))
      : [],
    suppressionInfo: suppressionInfo
      ? {
          isSuppressed: toBooleanOrNull(suppressionInfo.is_suppressed),
          reason: toStringOrNull(suppressionInfo.reason),
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
    uuid: toStringOrNull(user.uuid),
    email: toStringOrNull(user.email),
    fullName: toStringOrNull(user.full_name),
  }
}

export function normalizeCase(resource: JsonRecord): CrowdStrikeCase {
  const severityInfo = getRecord(resource.severity_info)
  const template = getRecord(resource.template)
  const sla = getRecord(resource.sla)
  const readOnly = getRecord(resource.read_only)

  return {
    id: toStringOrNull(resource.id),
    cid: toStringOrNull(resource.cid),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
    descriptionFormat: toStringOrNull(resource.description_format),
    status: toStringOrNull(resource.status),
    severity: toNumberOrNull(resource.severity),
    severityLevel: severityInfo ? toStringOrNull(severityInfo.level) : null,
    referenceId: toStringOrNull(resource.reference_id),
    version: toNumberOrNull(resource.version),
    tags: getStringArray(resource.tags),
    assignedTo: normalizeFalconUser(resource.assigned_to),
    createdBy: normalizeFalconUser(resource.created_by),
    lastUpdatedBy: normalizeFalconUser(resource.last_updated_by),
    createdTimestamp: toStringOrNull(resource.created_timestamp),
    updatedTimestamp: toStringOrNull(resource.updated_timestamp),
    startTimestamp: toStringOrNull(resource.start_timestamp),
    endTimestamp: toStringOrNull(resource.end_timestamp),
    templateId: template ? toStringOrNull(template.id) : null,
    templateName: template ? toStringOrNull(template.name) : null,
    slaId: sla ? toStringOrNull(sla.id) : null,
    slaName: sla ? toStringOrNull(sla.name) : null,
    isReadOnly: readOnly ? toBooleanOrNull(readOnly.is_read_only) : null,
  }
}
