import type {
  SdpAssetWriteParams,
  SdpChangeWriteParams,
  SdpProblemWriteParams,
  SdpSolutionWriteParams,
} from '@/tools/manageengine_sdp/types'
import {
  compactSdpEntity,
  orUndefined,
  parseSdpJson,
  toSdpDateTime,
  toSdpNameReference,
  toSdpUserReference,
} from '@/tools/manageengine_sdp/utils'

/**
 * Body fields shared by Add Problem and Edit Problem.
 *
 * Every absent field is dropped rather than sent as null, so an edit that
 * changes only the status never clears the technician or category.
 */
export function buildSdpProblemEntity(params: SdpProblemWriteParams): Record<string, unknown> {
  return compactSdpEntity({
    title: orUndefined(params.title),
    description: orUndefined(params.description),
    reported_by: toSdpUserReference(params.reportedByEmail),
    technician: toSdpUserReference(params.technicianEmail),
    priority: toSdpNameReference(params.priority),
    status: toSdpNameReference(params.status),
    urgency: toSdpNameReference(params.urgency),
    impact: toSdpNameReference(params.impact),
    category: toSdpNameReference(params.category),
    subcategory: toSdpNameReference(params.subcategory),
    group: toSdpNameReference(params.group),
    site: toSdpNameReference(params.site),
    udf_fields: parseSdpJson(params.udfFields, 'custom fields'),
  })
}

/**
 * Body fields shared by Add Change and Edit Change.
 *
 * `comment` is forwarded when supplied because SDP requires it on any edit that
 * changes `status` ("Whenever the user modifies the status, comment is
 * mandatory"). It is not enforced here — SDP owns that rule, and rejecting the
 * call locally would also block an Add, where no comment is expected.
 */
export function buildSdpChangeEntity(params: SdpChangeWriteParams): Record<string, unknown> {
  return compactSdpEntity({
    title: orUndefined(params.title),
    description: orUndefined(params.description),
    stage: toSdpNameReference(params.stage),
    status: toSdpNameReference(params.status),
    change_type: toSdpNameReference(params.changeTypeName),
    reason_for_change: toSdpNameReference(params.reasonForChange),
    priority: toSdpNameReference(params.priority),
    urgency: toSdpNameReference(params.urgency),
    impact: toSdpNameReference(params.impact),
    group: toSdpNameReference(params.group),
    change_requester: toSdpUserReference(params.changeRequesterEmail),
    change_owner: toSdpUserReference(params.changeOwnerEmail),
    change_manager: toSdpUserReference(params.changeManagerEmail),
    scheduled_start_time: toSdpDateTime(params.scheduledStartTime, 'Scheduled start time'),
    scheduled_end_time: toSdpDateTime(params.scheduledEndTime, 'Scheduled end time'),
    // Passed through as a real boolean rather than compacted away when false:
    // `false` is a meaningful value that downgrades an emergency change.
    emergency: typeof params.emergency === 'boolean' ? params.emergency : undefined,
    comment: orUndefined(params.comment),
    udf_fields: parseSdpJson(params.udfFields, 'custom fields'),
  })
}

/** Body fields shared by Add Asset and Edit Asset. */
export function buildSdpAssetEntity(params: SdpAssetWriteParams): Record<string, unknown> {
  return compactSdpEntity({
    name: orUndefined(params.name),
    product: toSdpNameReference(params.product),
    product_type: toSdpNameReference(params.productType),
    asset_tag: orUndefined(params.assetTag),
    serial_number: orUndefined(params.serialNumber),
    barcode: orUndefined(params.barcode),
    ip_address: orUndefined(params.ipAddress),
    mac_address: orUndefined(params.macAddress),
    location: orUndefined(params.location),
    state: toSdpNameReference(params.state),
    vendor: toSdpNameReference(params.vendor),
    department: toSdpNameReference(params.department),
    site: toSdpNameReference(params.site),
    user: toSdpUserReference(params.userEmail),
    // SDP documents this as the comment recorded against a state change; it is
    // ignored when `state` is unchanged.
    state_history_comments: orUndefined(params.stateHistoryComments),
    udf_fields: parseSdpJson(params.udfFields, 'custom fields'),
  })
}

/** Body fields shared by Add Solution and Edit Solution. */
export function buildSdpSolutionEntity(params: SdpSolutionWriteParams): Record<string, unknown> {
  return compactSdpEntity({
    title: orUndefined(params.title),
    description: orUndefined(params.description),
    topic: toSdpNameReference(params.topic),
    keywords: orUndefined(params.keywords),
    // SDP only honours `is_public: true` once the solution is Approved; sending
    // the flag on an unapproved solution is silently ignored rather than an error.
    is_public: typeof params.isPublic === 'boolean' ? params.isPublic : undefined,
    udf_fields: parseSdpJson(params.udfFields, 'custom fields'),
  })
}
