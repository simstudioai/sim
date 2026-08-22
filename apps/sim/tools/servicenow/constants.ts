/**
 * Out-of-box coded values for the ServiceNow tables the semantic tools target.
 *
 * ServiceNow stores choice fields as coded values, not labels — `state` on an
 * incident is `"6"`, not `"Resolved"`. Every value below is the base-system
 * value documented by ServiceNow. Instances with a customized state model or
 * added choices can differ, so each tool also accepts a raw value.
 */

/**
 * Incident `state` values.
 *
 * The state labels and their order come from the incident life cycle:
 * https://www.servicenow.com/docs/bundle/australia-it-service-management/page/product/incident-management/concept/c_IncidentManagementStateModel.html
 *
 * That page names the states but publishes no coded values, and ServiceNow does
 * not publish them anywhere else either — the scripting examples at
 * https://www.servicenow.com/docs/r/api-reference/scripts/r_UsefulFieldScripts.html
 * compare `6` and `7` but against the legacy `incident_state` field and without
 * naming either state. ServiceNow instead directs you to read the codes off your
 * own instance (right-click the field label, "Show Choice List"):
 * https://www.servicenow.com/docs/r/platform-administration/c_DetermValsAssocWChoicesScripting.html
 *
 * The values below are the long-standing base-system codes. Treat them as
 * defaults rather than guarantees; every control that offers them also accepts a
 * raw value so a customized state model stays reachable.
 */
export const INCIDENT_STATE = {
  NEW: '1',
  IN_PROGRESS: '2',
  ON_HOLD: '3',
  RESOLVED: '6',
  CLOSED: '7',
  CANCELED: '8',
} as const

export const INCIDENT_STATE_OPTIONS = [
  { label: 'New (1)', id: INCIDENT_STATE.NEW },
  { label: 'In Progress (2)', id: INCIDENT_STATE.IN_PROGRESS },
  { label: 'On Hold (3)', id: INCIDENT_STATE.ON_HOLD },
  { label: 'Resolved (6)', id: INCIDENT_STATE.RESOLVED },
  { label: 'Closed (7)', id: INCIDENT_STATE.CLOSED },
  { label: 'Canceled (8)', id: INCIDENT_STATE.CANCELED },
] as const

/** Incident and change `impact` / `urgency` values. */
export const IMPACT_URGENCY_OPTIONS = [
  { label: '1 - High', id: '1' },
  { label: '2 - Medium', id: '2' },
  { label: '3 - Low', id: '3' },
] as const

/** Task `priority` values. Priority is normally derived from impact and urgency. */
export const PRIORITY_OPTIONS = [
  { label: '1 - Critical', id: '1' },
  { label: '2 - High', id: '2' },
  { label: '3 - Moderate', id: '3' },
  { label: '4 - Low', id: '4' },
  { label: '5 - Planning', id: '5' },
] as const

/**
 * Change request `state` values for the change model state machine.
 * Source: https://www.servicenow.com/docs/bundle/australia-it-service-management/page/product/change-management/task/state-model-activate-tasks.html
 */
export const CHANGE_STATE = {
  NEW: '-5',
  ASSESS: '-4',
  AUTHORIZE: '-3',
  SCHEDULED: '-2',
  IMPLEMENT: '-1',
  REVIEW: '0',
  CLOSED: '3',
  CANCELED: '4',
} as const

export const CHANGE_STATE_OPTIONS = [
  { label: 'New (-5)', id: CHANGE_STATE.NEW },
  { label: 'Assess (-4)', id: CHANGE_STATE.ASSESS },
  { label: 'Authorize (-3)', id: CHANGE_STATE.AUTHORIZE },
  { label: 'Scheduled (-2)', id: CHANGE_STATE.SCHEDULED },
  { label: 'Implement (-1)', id: CHANGE_STATE.IMPLEMENT },
  { label: 'Review (0)', id: CHANGE_STATE.REVIEW },
  { label: 'Closed (3)', id: CHANGE_STATE.CLOSED },
  { label: 'Canceled (4)', id: CHANGE_STATE.CANCELED },
] as const

/** Change request `type` values. */
export const CHANGE_TYPE_OPTIONS = [
  { label: 'Normal', id: 'normal' },
  { label: 'Standard', id: 'standard' },
  { label: 'Emergency', id: 'emergency' },
] as const

/**
 * Change request `close_code` values, as assigned by the state-model upgrade
 * script in the change state model documentation.
 * Source: https://www.servicenow.com/docs/bundle/australia-it-service-management/page/product/change-management/task/state-model-activate-tasks.html
 */
export const CHANGE_CLOSE_CODE_OPTIONS = [
  { label: 'Successful', id: 'successful' },
  { label: 'Successful with issues', id: 'successful_issues' },
  { label: 'Unsuccessful', id: 'unsuccessful' },
] as const

/**
 * Approval record `state` values on the Approval [sysapproval_approver] table.
 *
 * The approval-status overview page
 * (https://www.servicenow.com/docs/r/build-workflows/approvals/c_ApprovalStatus.html)
 * names statuses without their coded values, but the Ask for Approval flow
 * action documents all seven as `Label [value]` — see
 * `markdown/build-workflows/workflow-studio/ask-approval-flow-designer.md` on
 * branch `australia` of https://github.com/ServiceNow/ServiceNowDocs.
 *
 * The punctuation is not uniform and not guessable: `not requested` uses a
 * space while `not_required` uses an underscore. `not_yet_requested` and
 * `no_longer_required` are not real values — ServiceNow accepts them into the
 * field and then never matches them, so a filter built from either silently
 * returns nothing.
 */
export const APPROVAL_STATE = {
  NOT_YET_REQUESTED: 'not requested',
  REQUESTED: 'requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  NOT_REQUIRED: 'not_required',
  SKIPPED: 'skipped',
} as const

/**
 * Filter options for reading approvals — every published state.
 */
export const APPROVAL_STATE_OPTIONS = [
  { label: 'Not Yet Requested', id: APPROVAL_STATE.NOT_YET_REQUESTED },
  { label: 'Requested', id: APPROVAL_STATE.REQUESTED },
  { label: 'Approved', id: APPROVAL_STATE.APPROVED },
  { label: 'Rejected', id: APPROVAL_STATE.REJECTED },
  { label: 'Cancelled', id: APPROVAL_STATE.CANCELLED },
  { label: 'No Longer Required', id: APPROVAL_STATE.NOT_REQUIRED },
  { label: 'Skipped', id: APPROVAL_STATE.SKIPPED },
] as const

/**
 * Decisions a caller can write with Update Approval.
 *
 * Deliberately narrower than `APPROVAL_STATE_OPTIONS`: the other five states are
 * set by the approval engine, not by an approver acting on a record.
 */
export const APPROVAL_DECISION_OPTIONS = [
  { label: 'Approve', id: APPROVAL_STATE.APPROVED },
  { label: 'Reject', id: APPROVAL_STATE.REJECTED },
] as const

/**
 * `sysparm_display_value` modes. The semantic tools default to `all` so a
 * reference field returns both its sys_id and its human-readable label.
 */
export const DISPLAY_VALUE_OPTIONS = [
  { label: 'Both value and display value (all)', id: 'all' },
  { label: 'Display values only (true)', id: 'true' },
  { label: 'Raw database values only (false)', id: 'false' },
] as const

/** Default `sysparm_display_value` applied by every semantic ServiceNow tool. */
export const DEFAULT_DISPLAY_VALUE = 'all'

/** Journal field a comment is written to. */
export const COMMENT_FIELD_OPTIONS = [
  { label: 'Work notes (internal)', id: 'work_notes' },
  { label: 'Additional comments (customer visible)', id: 'comments' },
] as const

export const SERVICENOW_TABLES = {
  INCIDENT: 'incident',
  CHANGE_REQUEST: 'change_request',
  CATALOG_ITEM: 'sc_cat_item',
  REQUESTED_ITEM: 'sc_req_item',
  APPROVAL: 'sysapproval_approver',
  CI: 'cmdb_ci',
  CI_RELATIONSHIP: 'cmdb_rel_ci',
  USER: 'sys_user',
  GROUP: 'sys_user_group',
  GROUP_MEMBER: 'sys_user_grmember',
} as const
