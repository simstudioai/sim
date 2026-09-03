import { ManageEngineIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { SDP_DATA_CENTER_BASES } from '@/tools/manageengine_sdp/data-centers'
import type { SdpResponse } from '@/tools/manageengine_sdp/types'

/**
 * Operations grouped by the entity they address. Every group is used twice —
 * once to drive subBlock `condition`/`required`, and once in `tools.config.params`
 * to scope a value to the operations that actually declare it.
 */
const REQUEST_ID_OPERATIONS = [
  'get_request',
  'update_request',
  'delete_request',
  'add_request_note',
  'list_request_notes',
]
const PROBLEM_ID_OPERATIONS = [
  'get_problem',
  'update_problem',
  'delete_problem',
  'add_problem_note',
  'list_problem_notes',
]
const CHANGE_ID_OPERATIONS = [
  'get_change',
  'update_change',
  'delete_change',
  'add_change_note',
  'list_change_notes',
]
const ASSET_ID_OPERATIONS = ['get_asset', 'update_asset', 'delete_asset']
const SOLUTION_ID_OPERATIONS = ['get_solution', 'update_solution', 'delete_solution']

const REQUEST_WRITE_OPERATIONS = ['create_request', 'update_request']
const PROBLEM_WRITE_OPERATIONS = ['create_problem', 'update_problem']
const CHANGE_WRITE_OPERATIONS = ['create_change', 'update_change']
const ASSET_WRITE_OPERATIONS = ['create_asset', 'update_asset']
const SOLUTION_WRITE_OPERATIONS = ['create_solution', 'update_solution']
const ADD_NOTE_OPERATIONS = ['add_request_note', 'add_problem_note', 'add_change_note']

/** Operations backed by a GET-list endpoint, which share the `list_info` fields. */
const LIST_OPERATIONS = [
  'list_requests',
  'list_request_notes',
  'list_problems',
  'list_problem_notes',
  'list_changes',
  'list_change_notes',
  'list_assets',
  'list_solutions',
]

/**
 * Data-center options, derived from the host map so the dropdown can never
 * drift from the set of bases the tools will actually call.
 */
const DATA_CENTER_OPTIONS = Object.keys(SDP_DATA_CENTER_BASES).map((code) => ({
  label: code,
  id: code,
}))

/**
 * Collapse the three "not supplied" shapes to `undefined`. The workflow
 * serializer initializes untouched subBlocks to `null`, and a cleared field
 * arrives as `''`; all three mean absent.
 */
function orUndefined(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') return value.trim() || undefined
  return value
}

/**
 * Coerce a pagination input to an integer at or above `min`, or `undefined`.
 * Anything out of range is discarded rather than forwarded: ServiceDesk Plus
 * answers a negative or fractional index with an opaque 4001.
 */
function toPaginationValue(value: unknown, min: number): number | undefined {
  const resolved = orUndefined(value)
  if (resolved === undefined) return undefined
  const parsed = Number(resolved)
  return Number.isInteger(parsed) && parsed >= min ? parsed : undefined
}

/**
 * Read a tri-state "leave unchanged / yes / no" dropdown.
 *
 * `undefined` means the field is omitted from the request body entirely, so the
 * server keeps whatever it already holds. Only an explicit Yes or No produces a
 * boolean — which is the whole point of using a dropdown rather than a switch on
 * an edit operation.
 */
function toOptionalBoolean(value: unknown): boolean | undefined {
  const resolved = orUndefined(value)
  if (resolved === undefined) return undefined
  return resolved === true || resolved === 'true'
}

export const ManageEngineSdpBlock: BlockConfig<SdpResponse> = {
  type: 'manageengine_sdp',
  name: 'ManageEngine ServiceDesk Plus',
  description:
    'Manage ServiceDesk Plus Cloud requests, problems, changes, assets, and knowledge base solutions',
  authMode: AuthMode.OAuth,
  longDescription:
    'Full read and write access to ManageEngine ServiceDesk Plus Cloud: create, search, update and delete requests, problems, changes, assets and knowledge base solutions, and add notes to requests, problems and changes. Supports multi-portal accounts. Connecting requires a Zoho account in the US data center.',
  docsLink: 'https://docs.sim.ai/integrations/manageengine_sdp',
  category: 'tools',
  integrationType: IntegrationType.Support,
  bgColor: '#FFFFFF',
  icon: ManageEngineIcon,
  canvasPresentation: {
    defaultTitle: 'ServiceDesk Plus',
    sentences: {
      byOperation: {
        create_request: [
          { text: 'Create request', field: 'subject', core: true },
          { text: 'for', field: 'requesterEmail' },
          { text: 'at priority', field: 'priority' },
        ],
        get_request: [{ text: 'Get request', field: 'requestId', core: true }],
        list_requests: ['List requests', { text: 'matching', field: 'searchCriteria' }],
        update_request: [
          { text: 'Update request', field: 'requestId', core: true },
          { text: ', setting status to', field: 'status' },
          { text: ', at priority', field: 'priority' },
        ],
        delete_request: [{ text: 'Delete request', field: 'requestId', core: true }],
        add_request_note: [
          { text: 'Add note', field: 'noteDescription', core: true },
          { text: 'to request', field: 'requestId', core: true },
        ],
        list_request_notes: [{ text: 'List notes on request', field: 'requestId', core: true }],
        create_problem: [
          { text: 'Create problem', field: 'problemTitle', core: true },
          { text: 'at priority', field: 'problemPriority' },
        ],
        get_problem: [{ text: 'Get problem', field: 'problemId', core: true }],
        list_problems: ['List problems', { text: 'matching', field: 'searchCriteria' }],
        update_problem: [
          { text: 'Update problem', field: 'problemId', core: true },
          { text: ', setting status to', field: 'problemStatus' },
        ],
        delete_problem: [{ text: 'Delete problem', field: 'problemId', core: true }],
        add_problem_note: [
          { text: 'Add note', field: 'noteDescription', core: true },
          { text: 'to problem', field: 'problemId', core: true },
        ],
        list_problem_notes: [{ text: 'List notes on problem', field: 'problemId', core: true }],
        create_change: [
          { text: 'Create change', field: 'changeTitle', core: true },
          { text: 'at stage', field: 'changeStage' },
          { text: 'with status', field: 'changeStatus' },
        ],
        get_change: [{ text: 'Get change', field: 'changeId', core: true }],
        list_changes: ['List changes', { text: 'matching', field: 'searchCriteria' }],
        update_change: [
          { text: 'Update change', field: 'changeId', core: true },
          { text: ', moving to stage', field: 'changeStage' },
          { text: ', setting status to', field: 'changeStatus' },
        ],
        delete_change: [{ text: 'Delete change', field: 'changeId', core: true }],
        add_change_note: [
          { text: 'Add note', field: 'noteDescription', core: true },
          { text: 'to change', field: 'changeId', core: true },
        ],
        list_change_notes: [{ text: 'List notes on change', field: 'changeId', core: true }],
        create_asset: [
          { text: 'Create asset', field: 'assetName', core: true },
          { text: 'of product', field: 'assetProduct', core: true },
        ],
        get_asset: [{ text: 'Get asset', field: 'assetId', core: true }],
        list_assets: ['List assets', { text: 'matching', field: 'searchCriteria' }],
        update_asset: [
          { text: 'Update asset', field: 'assetId', core: true },
          { text: ', setting state to', field: 'assetState' },
          { text: ', assigned to', field: 'assetUserEmail' },
        ],
        delete_asset: [{ text: 'Delete asset', field: 'assetId', core: true }],
        create_solution: [
          { text: 'Create solution', field: 'solutionTitle', core: true },
          { text: 'under topic', field: 'solutionTopic', core: true },
        ],
        get_solution: [{ text: 'Get solution', field: 'solutionId', core: true }],
        list_solutions: [
          'Search the knowledge base',
          { text: 'matching', field: 'searchCriteria' },
        ],
        update_solution: [
          { text: 'Update solution', field: 'solutionId', core: true },
          { text: ', retitled to', field: 'solutionTitle' },
        ],
        delete_solution: [{ text: 'Delete solution', field: 'solutionId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      // Ordered by module, then create → get → list → update → delete → notes,
      // so the menu reads the way the modules appear in the ServiceDesk Plus nav.
      options: [
        { label: 'Create Request', id: 'create_request' },
        { label: 'Get Request', id: 'get_request' },
        { label: 'List Requests', id: 'list_requests' },
        { label: 'Update Request', id: 'update_request' },
        { label: 'Delete Request', id: 'delete_request' },
        { label: 'Add Request Note', id: 'add_request_note' },
        { label: 'List Request Notes', id: 'list_request_notes' },
        { label: 'Create Problem', id: 'create_problem' },
        { label: 'Get Problem', id: 'get_problem' },
        { label: 'List Problems', id: 'list_problems' },
        { label: 'Update Problem', id: 'update_problem' },
        { label: 'Delete Problem', id: 'delete_problem' },
        { label: 'Add Problem Note', id: 'add_problem_note' },
        { label: 'List Problem Notes', id: 'list_problem_notes' },
        { label: 'Create Change', id: 'create_change' },
        { label: 'Get Change', id: 'get_change' },
        { label: 'List Changes', id: 'list_changes' },
        { label: 'Update Change', id: 'update_change' },
        { label: 'Delete Change', id: 'delete_change' },
        { label: 'Add Change Note', id: 'add_change_note' },
        { label: 'List Change Notes', id: 'list_change_notes' },
        { label: 'Create Asset', id: 'create_asset' },
        { label: 'Get Asset', id: 'get_asset' },
        { label: 'List Assets', id: 'list_assets' },
        { label: 'Update Asset', id: 'update_asset' },
        { label: 'Delete Asset', id: 'delete_asset' },
        { label: 'Create Solution', id: 'create_solution' },
        { label: 'Get Solution', id: 'get_solution' },
        { label: 'List Solutions', id: 'list_solutions' },
        { label: 'Update Solution', id: 'update_solution' },
        { label: 'Delete Solution', id: 'delete_solution' },
      ],
      value: () => 'list_requests',
    },
    {
      id: 'credential',
      title: 'ServiceDesk Plus Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'manageengine-sdp',
      requiredScopes: getScopesForService('manageengine-sdp'),
      placeholder: 'Select ServiceDesk Plus account',
    },
    {
      id: 'manualCredential',
      title: 'ServiceDesk Plus Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    // The data center is a closed list rather than a base-URL field: the value
    // selects which host receives the OAuth token, so the set of reachable
    // hosts stays fixed at build time.
    //
    // Only US is reachable with a credential connected through Sim today. The
    // authorize and token-exchange legs are pinned to accounts.zoho.com (see
    // lib/auth/connectors/providers.ts) and a Zoho access token is only valid in
    // the data center that issued it, so a non-US selection authenticates
    // against a host that does not know the token. The full list is kept because
    // it is the documented host mapping and becomes correct as soon as the grant
    // reads the `accounts-server` callback param — the same prerequisite the
    // zoho-desk connector documents for making its refresh data-center aware.
    {
      id: 'dataCenter',
      title: 'Data Center',
      type: 'dropdown',
      options: DATA_CENTER_OPTIONS,
      value: () => 'US',
    },
    {
      id: 'portal',
      title: 'Portal',
      type: 'short-input',
      placeholder: 'Portal URL name, e.g. itdesk. Leave empty for the default portal',
      mode: 'advanced',
    },
    // Entity identity. One subBlock per module rather than a shared `recordId`,
    // so an ID pasted for one module can never be sent to another.
    {
      id: 'requestId',
      title: 'Request ID',
      type: 'short-input',
      placeholder: 'Enter request ID',
      condition: { field: 'operation', value: REQUEST_ID_OPERATIONS },
      required: { field: 'operation', value: REQUEST_ID_OPERATIONS },
    },
    {
      id: 'problemId',
      title: 'Problem ID',
      type: 'short-input',
      placeholder: 'Enter problem ID',
      condition: { field: 'operation', value: PROBLEM_ID_OPERATIONS },
      required: { field: 'operation', value: PROBLEM_ID_OPERATIONS },
    },
    {
      id: 'changeId',
      title: 'Change ID',
      type: 'short-input',
      placeholder: 'Enter change ID',
      condition: { field: 'operation', value: CHANGE_ID_OPERATIONS },
      required: { field: 'operation', value: CHANGE_ID_OPERATIONS },
    },
    {
      id: 'assetId',
      title: 'Asset ID',
      type: 'short-input',
      placeholder: 'Enter asset ID',
      condition: { field: 'operation', value: ASSET_ID_OPERATIONS },
      required: { field: 'operation', value: ASSET_ID_OPERATIONS },
    },
    {
      id: 'solutionId',
      title: 'Solution ID',
      type: 'short-input',
      placeholder: 'Enter solution ID',
      condition: { field: 'operation', value: SOLUTION_ID_OPERATIONS },
      required: { field: 'operation', value: SOLUTION_ID_OPERATIONS },
    },
    // Request write fields.
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'What the request is about',
      condition: { field: 'operation', value: 'create_request' },
      required: { field: 'operation', value: 'create_request' },
    },
    // Split from the create-side subject: a subBlock keeps its value when the
    // operation changes, so one shared field would let a subject typed for a
    // new ticket silently rename an existing one on the next Update run.
    {
      id: 'updateSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'New subject',
      condition: { field: 'operation', value: 'update_request' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Request description. HTML is supported',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
    },
    {
      id: 'requesterEmail',
      title: 'Requester Email',
      type: 'short-input',
      placeholder: 'Defaults to the connected user',
      condition: { field: 'operation', value: 'create_request' },
    },
    {
      id: 'technicianEmail',
      title: 'Technician Email',
      type: 'short-input',
      placeholder: 'Email of the technician to assign',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
    },
    // Picklist values are portal-defined and renameable, so every one of these
    // is free text rather than a closed dropdown — a fixed option list would
    // lock out any portal that customized its own values. They are also split
    // per module: a status typed for a request ("Resolved") is not a valid
    // change status, and a subBlock keeps its value across an operation change.
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'e.g. High',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g. Open',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'subcategory',
      title: 'Subcategory',
      type: 'short-input',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'group',
      title: 'Support Group',
      type: 'short-input',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'urgency',
      title: 'Urgency',
      type: 'short-input',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'impact',
      title: 'Impact',
      type: 'short-input',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'requestType',
      title: 'Request Type',
      type: 'short-input',
      placeholder: 'e.g. Incident',
      condition: { field: 'operation', value: 'create_request' },
      mode: 'advanced',
    },
    {
      id: 'udfFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"udf_char1": "value"}',
      condition: { field: 'operation', value: REQUEST_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping ManageEngine ServiceDesk Plus user-defined field API names (they start with udf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    // Problem write fields.
    {
      id: 'problemTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'What the problem is',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_problem' },
    },
    {
      id: 'problemDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Problem description. HTML is supported',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
    },
    {
      id: 'problemStatus',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g. Open',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
    },
    {
      id: 'problemPriority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'e.g. High',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
    },
    {
      id: 'problemReportedByEmail',
      title: 'Reported By Email',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemTechnicianEmail',
      title: 'Technician Email',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemUrgency',
      title: 'Urgency',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemImpact',
      title: 'Impact',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemCategory',
      title: 'Category',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemSubcategory',
      title: 'Subcategory',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemGroup',
      title: 'Support Group',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemSite',
      title: 'Site',
      type: 'short-input',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'problemUdfFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"udf_char1": "value"}',
      condition: { field: 'operation', value: PROBLEM_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping ManageEngine ServiceDesk Plus user-defined field API names (they start with udf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    // Change write fields. `stage` and `status` are mandatory on create only.
    {
      id: 'changeTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'What the change is',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_change' },
    },
    {
      id: 'changeStage',
      title: 'Stage',
      type: 'short-input',
      placeholder: 'e.g. Submission',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_change' },
    },
    {
      id: 'changeStatus',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g. Open',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_change' },
    },
    {
      id: 'changeDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Change description. HTML is supported',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
    },
    // ServiceDesk Plus rejects an edit that moves the status without a comment,
    // so this is surfaced in basic mode rather than hidden behind Advanced.
    {
      id: 'changeComment',
      title: 'Status Comment',
      type: 'long-input',
      placeholder: 'Required by ServiceDesk Plus whenever the status changes',
      condition: { field: 'operation', value: 'update_change' },
    },
    {
      id: 'changeTypeName',
      title: 'Change Type',
      type: 'short-input',
      placeholder: 'e.g. Standard',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'reasonForChange',
      title: 'Reason for Change',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changePriority',
      title: 'Priority',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changeUrgency',
      title: 'Urgency',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changeImpact',
      title: 'Impact',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changeGroup',
      title: 'Support Group',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changeRequesterEmail',
      title: 'Requester Email',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changeOwnerEmail',
      title: 'Owner Email',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'changeManagerEmail',
      title: 'Manager Email',
      type: 'short-input',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'scheduledStartTime',
      title: 'Scheduled Start',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'scheduledEndTime',
      title: 'Scheduled End',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    // Create-side switch: the UI's stated value is sent explicitly, because
    // ServiceDesk Plus documents no default for `emergency` and omitting it
    // would silently defer to an unverified one.
    {
      id: 'emergency',
      title: 'Emergency Change',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'create_change' },
      mode: 'advanced',
    },
    // Edit-side tri-state. A switch cannot express "leave as-is": an untouched
    // one is indistinguishable from an explicit "off", so rescheduling an
    // emergency change would silently downgrade it. The empty option is the
    // default and omits the field entirely.
    {
      id: 'updateEmergency',
      title: 'Emergency Change',
      type: 'dropdown',
      options: [
        { label: 'Leave unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'update_change' },
      mode: 'advanced',
    },
    {
      id: 'changeUdfFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"udf_char1": "value"}',
      condition: { field: 'operation', value: CHANGE_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping ManageEngine ServiceDesk Plus user-defined field API names (they start with udf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    // Asset write fields. `name` and `product` are mandatory on create only.
    {
      id: 'assetName',
      title: 'Asset Name',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_asset' },
    },
    {
      id: 'assetProduct',
      title: 'Product',
      type: 'short-input',
      placeholder: 'Name of an existing product',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_asset' },
    },
    {
      id: 'assetState',
      title: 'State',
      type: 'short-input',
      placeholder: 'e.g. In Use',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
    },
    {
      id: 'assetUserEmail',
      title: 'Assigned To Email',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
    },
    {
      id: 'assetProductType',
      title: 'Product Type',
      type: 'short-input',
      placeholder: 'e.g. Laptop',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'assetTag',
      title: 'Asset Tag',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'serialNumber',
      title: 'Serial Number',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'barcode',
      title: 'Barcode',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'ipAddress',
      title: 'IP Address',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'macAddress',
      title: 'MAC Address',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'assetLocation',
      title: 'Location',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'assetVendor',
      title: 'Vendor',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'assetDepartment',
      title: 'Department',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'assetSite',
      title: 'Site',
      type: 'short-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'stateHistoryComments',
      title: 'State Change Comment',
      type: 'long-input',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'assetUdfFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"udf_char1": "value"}',
      condition: { field: 'operation', value: ASSET_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping ManageEngine ServiceDesk Plus user-defined field API names (they start with udf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    // Solution write fields. All three are mandatory on create only.
    {
      id: 'solutionTitle',
      title: 'Title',
      type: 'short-input',
      condition: { field: 'operation', value: SOLUTION_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_solution' },
    },
    {
      id: 'solutionDescription',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Solution body. HTML is supported',
      condition: { field: 'operation', value: SOLUTION_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_solution' },
    },
    {
      id: 'solutionTopic',
      title: 'Topic',
      type: 'short-input',
      placeholder: 'Name of an existing knowledge base topic',
      condition: { field: 'operation', value: SOLUTION_WRITE_OPERATIONS },
      required: { field: 'operation', value: 'create_solution' },
    },
    {
      id: 'solutionKeywords',
      title: 'Keywords',
      type: 'short-input',
      condition: { field: 'operation', value: SOLUTION_WRITE_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'solutionIsPublic',
      title: 'Visible to Requesters',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'create_solution' },
      mode: 'advanced',
    },
    // Tri-state for the same reason as `updateEmergency`: an untouched switch
    // here would unpublish a live knowledge base article on any edit that only
    // meant to fix its title.
    {
      id: 'updateSolutionIsPublic',
      title: 'Visible to Requesters',
      type: 'dropdown',
      options: [
        { label: 'Leave unchanged', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'update_solution' },
      mode: 'advanced',
    },
    {
      id: 'solutionUdfFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: '{"udf_char1": "value"}',
      condition: { field: 'operation', value: SOLUTION_WRITE_OPERATIONS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object mapping ManageEngine ServiceDesk Plus user-defined field API names (they start with udf_) to values. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    // Note body, shared by all three add-note operations. Unlike the picklists
    // above these genuinely are one concept — the note text — and only one
    // add-note operation can be active at a time.
    {
      id: 'noteDescription',
      title: 'Note',
      type: 'long-input',
      placeholder: 'Note body. HTML is supported',
      condition: { field: 'operation', value: ADD_NOTE_OPERATIONS },
      required: { field: 'operation', value: ADD_NOTE_OPERATIONS },
    },
    // Request-note visibility flags. Problem and change notes accept only a
    // description, so these are scoped to add_request_note alone.
    {
      id: 'showToRequester',
      title: 'Visible to Requester',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'add_request_note' },
    },
    {
      id: 'notifyTechnician',
      title: 'Notify Technician',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'add_request_note' },
      mode: 'advanced',
    },
    {
      id: 'markFirstResponse',
      title: 'Mark as First Response',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'add_request_note' },
      mode: 'advanced',
    },
    {
      id: 'addToLinkedRequests',
      title: 'Add to Linked Requests',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: 'add_request_note' },
      mode: 'advanced',
    },
    // Shared list_info fields. Every list endpoint accepts the same object, so
    // unlike the picklists above these are genuinely one concept and can share
    // a subBlock across operations.
    {
      id: 'searchCriteria',
      title: 'Search Criteria',
      type: 'long-input',
      placeholder: '{"field": "status.name", "condition": "is", "value": "Open"}',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a ManageEngine ServiceDesk Plus search_criteria object (or an array of them). Each has "field", "condition" (one of: is, is not, lesser than, greater than, lesser or equal, greater or equal, contains, not contains, starts with, ends with, between) and "value". Return ONLY the JSON - no explanations.',
        generationType: 'json-object',
      },
    },
    {
      id: 'rowCount',
      title: 'Row Count',
      type: 'short-input',
      placeholder: 'Rows to return (max 100)',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'startIndex',
      title: 'Start Index',
      type: 'short-input',
      placeholder: 'One-based index of the first row',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'sortField',
      title: 'Sort Field',
      type: 'short-input',
      placeholder: 'e.g. created_time',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      // The empty option is required, not cosmetic: a dropdown with no empty
      // entry seeds its first option into the store on mount, so merely opening
      // the advanced fields would pin every list run to one direction.
      options: [
        { label: 'Default', id: '' },
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'fieldsRequired',
      title: 'Fields Required',
      type: 'long-input',
      placeholder: '["subject", "status"]',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'getTotalCount',
      title: 'Include Total Count',
      type: 'switch',
      defaultValue: false,
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'manageengine_sdp_create_request',
      'manageengine_sdp_get_request',
      'manageengine_sdp_list_requests',
      'manageengine_sdp_update_request',
      'manageengine_sdp_delete_request',
      'manageengine_sdp_add_request_note',
      'manageengine_sdp_list_request_notes',
      'manageengine_sdp_create_problem',
      'manageengine_sdp_get_problem',
      'manageengine_sdp_list_problems',
      'manageengine_sdp_update_problem',
      'manageengine_sdp_delete_problem',
      'manageengine_sdp_add_problem_note',
      'manageengine_sdp_list_problem_notes',
      'manageengine_sdp_create_change',
      'manageengine_sdp_get_change',
      'manageengine_sdp_list_changes',
      'manageengine_sdp_update_change',
      'manageengine_sdp_delete_change',
      'manageengine_sdp_add_change_note',
      'manageengine_sdp_list_change_notes',
      'manageengine_sdp_create_asset',
      'manageengine_sdp_get_asset',
      'manageengine_sdp_list_assets',
      'manageengine_sdp_update_asset',
      'manageengine_sdp_delete_asset',
      'manageengine_sdp_create_solution',
      'manageengine_sdp_get_solution',
      'manageengine_sdp_list_solutions',
      'manageengine_sdp_update_solution',
      'manageengine_sdp_delete_solution',
    ],
    config: {
      tool: (params) => `manageengine_sdp_${params.operation}`,
      params: (params) => {
        // The agent-tool path does not carry `operation` inside params - it is a
        // sibling of the tool call, used only to pick the tool - and there the
        // model addresses tool params by their real names. The tool is already
        // selected, so there is no cross-operation leak to guard against, while
        // running the scoping below WOULD overwrite the model's own values with
        // `undefined`.
        if (typeof params.operation !== 'string') return params

        // IMPORTANT: leaving a key out of the result does NOT keep it from the
        // tool. Both call sites merge this return value on top of the original
        // inputs, so a key omitted here is simply restored. The only way to
        // scope a param to an operation is to OVERWRITE it with `undefined`.
        //
        // This matters because a `mode: 'advanced'` subBlock with a retained
        // value is serialized for every operation when the block's advanced
        // toggle is off, so stale advanced values genuinely do arrive here
        // under an unrelated operation. Every module-prefixed subBlock below is
        // therefore funnelled into the shared tool param name and every
        // inactive module's value is explicitly cleared.
        const operation = params.operation
        const {
          // The five entity ids are destructured out and republished scoped
          // below. Passing them through would send a problem id typed earlier to
          // a request tool, which does not declare it — inert on the wire today,
          // but it puts an unrelated record's id into the tool call and its logs.
          requestId,
          problemId,
          changeId,
          assetId,
          solutionId,
          // Module-prefixed subBlock ids never travel to a tool under their own
          // name; each is republished below under the tool's param name.
          updateSubject,
          noteDescription,
          problemTitle,
          problemDescription,
          problemStatus,
          problemPriority,
          problemUrgency,
          problemImpact,
          problemCategory,
          problemSubcategory,
          problemGroup,
          problemSite,
          problemReportedByEmail,
          problemTechnicianEmail,
          problemUdfFields,
          changeTitle,
          changeDescription,
          changeStage,
          changeStatus,
          changePriority,
          changeUrgency,
          changeImpact,
          changeGroup,
          changeComment,
          changeUdfFields,
          assetName,
          assetProduct,
          assetProductType,
          assetState,
          assetLocation,
          assetVendor,
          assetDepartment,
          assetSite,
          assetUserEmail,
          assetUdfFields,
          solutionTitle,
          solutionDescription,
          solutionTopic,
          solutionKeywords,
          solutionIsPublic,
          updateSolutionIsPublic,
          solutionUdfFields,
          rowCount: rawRowCount,
          startIndex: rawStartIndex,
          getTotalCount,
          showToRequester,
          notifyTechnician,
          markFirstResponse,
          addToLinkedRequests,
          emergency,
          updateEmergency,
          ...rest
        } = params
        const result: Record<string, unknown> = { ...rest }

        const isCreateRequest = operation === 'create_request'
        const isUpdateRequest = operation === 'update_request'
        const isRequestWrite = REQUEST_WRITE_OPERATIONS.includes(operation)
        const isProblemWrite = PROBLEM_WRITE_OPERATIONS.includes(operation)
        const isChangeWrite = CHANGE_WRITE_OPERATIONS.includes(operation)
        const isAssetWrite = ASSET_WRITE_OPERATIONS.includes(operation)
        const isSolutionWrite = SOLUTION_WRITE_OPERATIONS.includes(operation)
        const isAddNote = ADD_NOTE_OPERATIONS.includes(operation)
        const isList = LIST_OPERATIONS.includes(operation)

        // Each entity id reaches only the module that addresses it. `create_*`
        // operations are absent from every list, so a create never carries an id.
        result.requestId = REQUEST_ID_OPERATIONS.includes(operation)
          ? orUndefined(requestId)
          : undefined
        result.problemId = PROBLEM_ID_OPERATIONS.includes(operation)
          ? orUndefined(problemId)
          : undefined
        result.changeId = CHANGE_ID_OPERATIONS.includes(operation)
          ? orUndefined(changeId)
          : undefined
        result.assetId = ASSET_ID_OPERATIONS.includes(operation) ? orUndefined(assetId) : undefined
        result.solutionId = SOLUTION_ID_OPERATIONS.includes(operation)
          ? orUndefined(solutionId)
          : undefined

        // `subject` is the create-side field and `updateSubject` the edit-side
        // one; both map onto the single `subject` param the request tools take.
        result.subject = isCreateRequest
          ? orUndefined(params.subject)
          : isUpdateRequest
            ? orUndefined(updateSubject)
            : undefined

        // `title` is shared by the problem, change and solution tools; exactly
        // one module's subBlock may reach it.
        result.title = isProblemWrite
          ? orUndefined(problemTitle)
          : isChangeWrite
            ? orUndefined(changeTitle)
            : isSolutionWrite
              ? orUndefined(solutionTitle)
              : undefined

        // `description` is the busiest shared param: a request/problem/change
        // body, a solution's content, and every note's text all land on it.
        result.description = isAddNote
          ? orUndefined(noteDescription)
          : isRequestWrite
            ? orUndefined(params.description)
            : isProblemWrite
              ? orUndefined(problemDescription)
              : isChangeWrite
                ? orUndefined(changeDescription)
                : isSolutionWrite
                  ? orUndefined(solutionDescription)
                  : undefined

        result.status = isRequestWrite
          ? orUndefined(params.status)
          : isProblemWrite
            ? orUndefined(problemStatus)
            : isChangeWrite
              ? orUndefined(changeStatus)
              : undefined

        result.priority = isRequestWrite
          ? orUndefined(params.priority)
          : isProblemWrite
            ? orUndefined(problemPriority)
            : isChangeWrite
              ? orUndefined(changePriority)
              : undefined

        result.urgency = isRequestWrite
          ? orUndefined(params.urgency)
          : isProblemWrite
            ? orUndefined(problemUrgency)
            : isChangeWrite
              ? orUndefined(changeUrgency)
              : undefined

        result.impact = isRequestWrite
          ? orUndefined(params.impact)
          : isProblemWrite
            ? orUndefined(problemImpact)
            : isChangeWrite
              ? orUndefined(changeImpact)
              : undefined

        result.group = isRequestWrite
          ? orUndefined(params.group)
          : isProblemWrite
            ? orUndefined(problemGroup)
            : isChangeWrite
              ? orUndefined(changeGroup)
              : undefined

        result.category = isRequestWrite
          ? orUndefined(params.category)
          : isProblemWrite
            ? orUndefined(problemCategory)
            : undefined

        result.subcategory = isRequestWrite
          ? orUndefined(params.subcategory)
          : isProblemWrite
            ? orUndefined(problemSubcategory)
            : undefined

        result.site = isProblemWrite
          ? orUndefined(problemSite)
          : isAssetWrite
            ? orUndefined(assetSite)
            : undefined

        result.udfFields = isRequestWrite
          ? orUndefined(params.udfFields)
          : isProblemWrite
            ? orUndefined(problemUdfFields)
            : isChangeWrite
              ? orUndefined(changeUdfFields)
              : isAssetWrite
                ? orUndefined(assetUdfFields)
                : isSolutionWrite
                  ? orUndefined(solutionUdfFields)
                  : undefined

        // Request-only write fields.
        result.requesterEmail = isCreateRequest ? orUndefined(params.requesterEmail) : undefined
        result.requestType = isCreateRequest ? orUndefined(params.requestType) : undefined
        result.technicianEmail = isRequestWrite
          ? orUndefined(params.technicianEmail)
          : isProblemWrite
            ? orUndefined(problemTechnicianEmail)
            : undefined
        result.reportedByEmail = isProblemWrite ? orUndefined(problemReportedByEmail) : undefined

        // Change-only write fields.
        result.stage = isChangeWrite ? orUndefined(changeStage) : undefined
        result.comment = isChangeWrite ? orUndefined(changeComment) : undefined
        result.changeTypeName = isChangeWrite ? orUndefined(params.changeTypeName) : undefined
        result.reasonForChange = isChangeWrite ? orUndefined(params.reasonForChange) : undefined
        result.changeRequesterEmail = isChangeWrite
          ? orUndefined(params.changeRequesterEmail)
          : undefined
        result.changeOwnerEmail = isChangeWrite ? orUndefined(params.changeOwnerEmail) : undefined
        result.changeManagerEmail = isChangeWrite
          ? orUndefined(params.changeManagerEmail)
          : undefined
        result.scheduledStartTime = isChangeWrite
          ? orUndefined(params.scheduledStartTime)
          : undefined
        result.scheduledEndTime = isChangeWrite ? orUndefined(params.scheduledEndTime) : undefined
        // Switches carry a defaultValue, so forwarding them unconditionally
        // would serialize a module-only field onto every other operation.
        //
        // Create and edit are deliberately asymmetric. On create the switch's
        // stated value is sent explicitly, because ServiceDesk Plus documents no
        // default for `emergency`. On edit only an explicit Yes/No is sent, so
        // rescheduling a change never downgrades an emergency someone else set.
        result.emergency =
          operation === 'create_change'
            ? emergency === true
            : operation === 'update_change'
              ? toOptionalBoolean(updateEmergency)
              : undefined

        // Asset-only write fields.
        result.name = isAssetWrite ? orUndefined(assetName) : undefined
        result.product = isAssetWrite ? orUndefined(assetProduct) : undefined
        result.productType = isAssetWrite ? orUndefined(assetProductType) : undefined
        result.state = isAssetWrite ? orUndefined(assetState) : undefined
        result.location = isAssetWrite ? orUndefined(assetLocation) : undefined
        result.vendor = isAssetWrite ? orUndefined(assetVendor) : undefined
        result.department = isAssetWrite ? orUndefined(assetDepartment) : undefined
        result.userEmail = isAssetWrite ? orUndefined(assetUserEmail) : undefined
        result.assetTag = isAssetWrite ? orUndefined(params.assetTag) : undefined
        result.serialNumber = isAssetWrite ? orUndefined(params.serialNumber) : undefined
        result.barcode = isAssetWrite ? orUndefined(params.barcode) : undefined
        result.ipAddress = isAssetWrite ? orUndefined(params.ipAddress) : undefined
        result.macAddress = isAssetWrite ? orUndefined(params.macAddress) : undefined
        result.stateHistoryComments = isAssetWrite
          ? orUndefined(params.stateHistoryComments)
          : undefined

        // Solution-only write fields.
        result.topic = isSolutionWrite ? orUndefined(solutionTopic) : undefined
        result.keywords = isSolutionWrite ? orUndefined(solutionKeywords) : undefined
        // Same asymmetry as `emergency`: an edit that only retitles an article
        // must not unpublish it from the requester portal.
        result.isPublic =
          operation === 'create_solution'
            ? solutionIsPublic === true
            : operation === 'update_solution'
              ? toOptionalBoolean(updateSolutionIsPublic)
              : undefined

        // Request-note visibility flags; problem and change notes take none.
        const isRequestNote = operation === 'add_request_note'
        result.showToRequester = isRequestNote ? showToRequester === true : undefined
        result.notifyTechnician = isRequestNote ? notifyTechnician === true : undefined
        result.markFirstResponse = isRequestNote ? markFirstResponse === true : undefined
        result.addToLinkedRequests = isRequestNote ? addToLinkedRequests === true : undefined

        // list_info fields, scoped to the list endpoints that accept them.
        // `null` is handled inside toPaginationValue: the serializer initializes
        // untouched subBlocks to null, and Number(null) is 0 — which would
        // otherwise inject start_index=0 and be rejected as out of range.
        result.rowCount = isList ? toPaginationValue(rawRowCount, 1) : undefined
        result.startIndex = isList ? toPaginationValue(rawStartIndex, 1) : undefined
        result.sortField = isList ? orUndefined(params.sortField) : undefined
        result.sortOrder = isList ? orUndefined(params.sortOrder) : undefined
        result.searchCriteria = isList ? orUndefined(params.searchCriteria) : undefined
        result.fieldsRequired = isList ? orUndefined(params.fieldsRequired) : undefined
        result.getTotalCount = isList ? getTotalCount === true : undefined

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'ServiceDesk Plus credential' },
    dataCenter: { type: 'string', description: 'Zoho data center hosting the portal' },
    portal: { type: 'string', description: 'Portal URL name' },
    requestId: { type: 'string', description: 'Request ID' },
    problemId: { type: 'string', description: 'Problem ID' },
    changeId: { type: 'string', description: 'Change ID' },
    assetId: { type: 'string', description: 'Asset ID' },
    solutionId: { type: 'string', description: 'Solution ID' },
    subject: { type: 'string', description: 'Request subject' },
    updateSubject: { type: 'string', description: 'New request subject' },
    description: { type: 'string', description: 'Request description' },
    noteDescription: { type: 'string', description: 'Note body' },
    requesterEmail: { type: 'string', description: 'Requester email address' },
    technicianEmail: { type: 'string', description: 'Technician email address' },
    priority: { type: 'string', description: 'Request priority name' },
    status: { type: 'string', description: 'Request status name' },
    category: { type: 'string', description: 'Request category name' },
    subcategory: { type: 'string', description: 'Request subcategory name' },
    group: { type: 'string', description: 'Request support group name' },
    urgency: { type: 'string', description: 'Request urgency name' },
    impact: { type: 'string', description: 'Request impact name' },
    requestType: { type: 'string', description: 'Request type name' },
    udfFields: { type: 'json', description: 'Request custom field values' },
    problemTitle: { type: 'string', description: 'Problem title' },
    problemDescription: { type: 'string', description: 'Problem description' },
    problemStatus: { type: 'string', description: 'Problem status name' },
    problemPriority: { type: 'string', description: 'Problem priority name' },
    problemUrgency: { type: 'string', description: 'Problem urgency name' },
    problemImpact: { type: 'string', description: 'Problem impact name' },
    problemCategory: { type: 'string', description: 'Problem category name' },
    problemSubcategory: { type: 'string', description: 'Problem subcategory name' },
    problemGroup: { type: 'string', description: 'Problem support group name' },
    problemSite: { type: 'string', description: 'Problem site name' },
    problemReportedByEmail: { type: 'string', description: 'Email of the reporting user' },
    problemTechnicianEmail: { type: 'string', description: 'Problem technician email address' },
    problemUdfFields: { type: 'json', description: 'Problem custom field values' },
    changeTitle: { type: 'string', description: 'Change title' },
    changeDescription: { type: 'string', description: 'Change description' },
    changeStage: { type: 'string', description: 'Change stage name' },
    changeStatus: { type: 'string', description: 'Change status name' },
    changePriority: { type: 'string', description: 'Change priority name' },
    changeUrgency: { type: 'string', description: 'Change urgency name' },
    changeImpact: { type: 'string', description: 'Change impact name' },
    changeGroup: { type: 'string', description: 'Change support group name' },
    changeComment: { type: 'string', description: 'Reason for a change status update' },
    changeTypeName: { type: 'string', description: 'Change type name' },
    reasonForChange: { type: 'string', description: 'Reason-for-change name' },
    changeRequesterEmail: { type: 'string', description: 'Change requester email address' },
    changeOwnerEmail: { type: 'string', description: 'Change owner email address' },
    changeManagerEmail: { type: 'string', description: 'Change manager email address' },
    scheduledStartTime: { type: 'string', description: 'Change scheduled start' },
    scheduledEndTime: { type: 'string', description: 'Change scheduled end' },
    emergency: { type: 'boolean', description: 'Whether the change is an emergency' },
    updateEmergency: {
      type: 'string',
      description: 'Change the emergency flag, or leave unchanged',
    },
    changeUdfFields: { type: 'json', description: 'Change custom field values' },
    assetName: { type: 'string', description: 'Asset name' },
    assetProduct: { type: 'string', description: 'Asset product name' },
    assetProductType: { type: 'string', description: 'Asset product type name' },
    assetState: { type: 'string', description: 'Asset state name' },
    assetLocation: { type: 'string', description: 'Asset location' },
    assetVendor: { type: 'string', description: 'Asset vendor name' },
    assetDepartment: { type: 'string', description: 'Asset department name' },
    assetSite: { type: 'string', description: 'Asset site name' },
    assetUserEmail: { type: 'string', description: 'Email of the assigned user' },
    assetTag: { type: 'string', description: 'Asset tag' },
    serialNumber: { type: 'string', description: 'Asset serial number' },
    barcode: { type: 'string', description: 'Asset barcode' },
    ipAddress: { type: 'string', description: 'Asset IP address' },
    macAddress: { type: 'string', description: 'Asset MAC address' },
    stateHistoryComments: { type: 'string', description: 'Comment for an asset state change' },
    assetUdfFields: { type: 'json', description: 'Asset custom field values' },
    solutionTitle: { type: 'string', description: 'Solution title' },
    solutionDescription: { type: 'string', description: 'Solution body' },
    solutionTopic: { type: 'string', description: 'Knowledge base topic name' },
    solutionKeywords: { type: 'string', description: 'Solution keywords' },
    solutionIsPublic: { type: 'boolean', description: 'Whether requesters can see the solution' },
    updateSolutionIsPublic: {
      type: 'string',
      description: 'Change requester visibility, or leave unchanged',
    },
    solutionUdfFields: { type: 'json', description: 'Solution custom field values' },
    showToRequester: {
      type: 'boolean',
      description: 'Whether the note is visible to the requester',
    },
    notifyTechnician: { type: 'boolean', description: 'Whether to notify the technician' },
    markFirstResponse: { type: 'boolean', description: 'Whether the note is the first response' },
    addToLinkedRequests: {
      type: 'boolean',
      description: 'Whether to copy the note to linked requests',
    },
    searchCriteria: { type: 'json', description: 'Search criteria for a list operation' },
    fieldsRequired: { type: 'json', description: 'Fields to return on a list operation' },
    rowCount: { type: 'number', description: 'Rows to return (max 100)' },
    startIndex: { type: 'number', description: 'One-based index of the first row' },
    sortField: { type: 'string', description: 'Field to sort on' },
    sortOrder: { type: 'string', description: 'Sort direction (asc or desc)' },
    getTotalCount: { type: 'boolean', description: 'Include the total matching row count' },
  },
  outputs: {
    request: { type: 'json', description: 'A single request' },
    requests: { type: 'array', description: 'List of requests' },
    note: { type: 'json', description: 'A single note' },
    notes: { type: 'array', description: 'List of notes' },
    problem: { type: 'json', description: 'A single problem' },
    problems: { type: 'array', description: 'List of problems' },
    change: { type: 'json', description: 'A single change' },
    changes: { type: 'array', description: 'List of changes' },
    asset: { type: 'json', description: 'A single asset' },
    assets: { type: 'array', description: 'List of assets' },
    solution: { type: 'json', description: 'A single solution' },
    solutions: { type: 'array', description: 'List of solutions' },
    deleted: { type: 'boolean', description: 'Whether the record was deleted' },
    count: { type: 'number', description: 'Number of items returned' },
    listInfo: { type: 'json', description: 'Paging metadata echoed by ServiceDesk Plus' },
  },
}

export const ManageEngineSdpBlockMeta = {
  tags: ['ticketing', 'customer-support', 'incident-management', 'automation'],
  url: 'https://www.manageengine.com/products/service-desk/',
  templates: [
    {
      icon: ManageEngineIcon,
      title: 'Triage new ServiceDesk Plus requests',
      prompt:
        'Every 15 minutes, list ServiceDesk Plus requests with status Open and no technician assigned. For each one, read the subject and description, decide whether it is a hardware, software, access or network issue, then update the request with the matching category and support group.',
      modules: ['agent', 'scheduled'],
      category: 'operations',
      tags: ['triage', 'automation'],
    },
    {
      icon: ManageEngineIcon,
      title: 'File a ServiceDesk Plus ticket from Slack',
      prompt:
        'When someone posts in the #it-help Slack channel, create a ServiceDesk Plus request with their message as the description and the first line as the subject, then reply in the thread with the request number.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['intake', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Daily ServiceDesk Plus SLA breach report',
      prompt:
        'Every weekday at 8am, list ServiceDesk Plus requests whose due-by time has passed and that are not yet resolved. Summarize them by support group and email the summary to the service desk manager.',
      modules: ['scheduled', 'agent'],
      category: 'operations',
      tags: ['reporting', 'sla'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Deflect ServiceDesk Plus tickets with the knowledge base',
      prompt:
        'When a new ServiceDesk Plus request arrives, search ServiceDesk Plus solutions for an article matching its subject. If one is found, add a note to the request quoting the solution and mark it visible to the requester; otherwise assign it to the service desk group.',
      modules: ['agent'],
      category: 'support',
      tags: ['deflection', 'knowledge-base'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Turn a resolved ServiceDesk Plus ticket into a solution',
      prompt:
        'Given a resolved ServiceDesk Plus request ID, read the request and its notes, then draft a knowledge base solution covering the symptom and the fix and create it under the IT Support topic with relevant keywords.',
      modules: ['agent'],
      category: 'support',
      tags: ['knowledge-base', 'documentation'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Escalate recurring ServiceDesk Plus incidents to a problem',
      prompt:
        'Once a day, list ServiceDesk Plus requests created in the last 7 days and group them by category and subcategory. For any category with five or more requests that has no matching open problem, create a problem record describing the pattern and add a note listing the request IDs.',
      modules: ['scheduled', 'agent'],
      category: 'operations',
      tags: ['problem-management', 'automation'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Open a ServiceDesk Plus change from an approved plan',
      prompt:
        'When a maintenance plan is approved, create a ServiceDesk Plus change at the Submission stage with status Open, set its scheduled start and end times, assign the change manager, and add a note with the rollout steps.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['change-management', 'automation'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Post the ServiceDesk Plus change calendar to Slack',
      prompt:
        'Every Monday morning, list ServiceDesk Plus changes scheduled for the coming week and post a summary to the #change-management Slack channel, grouped by change type and showing the owner of each.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['change-management', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Sync ServiceDesk Plus asset inventory to a table',
      prompt:
        'Every night, page through all ServiceDesk Plus assets and write their name, asset tag, serial number, state and assigned user into a Sim table so the inventory can be queried and charted.',
      modules: ['scheduled', 'tables'],
      category: 'operations',
      tags: ['asset-management', 'inventory'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Reassign ServiceDesk Plus assets when someone leaves',
      prompt:
        'Given a departing employee email, list ServiceDesk Plus assets assigned to them, set each one to the In Store state with a state change comment naming the offboarding ticket, and create a request for IT to collect the hardware.',
      modules: ['agent'],
      category: 'operations',
      tags: ['offboarding', 'asset-management'],
    },
    {
      icon: ManageEngineIcon,
      title: 'Summarize a ServiceDesk Plus ticket thread',
      prompt:
        'Given a ServiceDesk Plus request ID, read the request and all of its notes, then produce a short handover summary covering what was reported, what has been tried, and what the next step should be.',
      modules: ['agent'],
      category: 'support',
      tags: ['summarization', 'handover'],
    },
  ],
  skills: [
    {
      name: 'triage-new-request',
      description:
        'Read an incoming ServiceDesk Plus request, classify it, and set its category, priority and support group.',
      content:
        '# Triage a ServiceDesk Plus Request\n\nClassify a newly created request and route it to the right owner.\n\n## Steps\n1. Get Request for the request ID and read subject, description, requester and created_time.\n2. Decide the urgency and the owning team from the content. Category, subcategory, priority and group are portal-defined picklists, so use the names configured in this portal rather than assuming a standard set.\n3. Update Request to set category, subcategory, priority, urgency, impact and group, plus the technician email if the owner is known.\n4. Add Request Note explaining the triage decision. Leave "visible to requester" off so the reasoning stays internal.\n\n## Output\nReport the request ID and display_id, the classification and priority set, the group or technician it was routed to, and anything ambiguous that needs a human decision.',
    },
    {
      name: 'escalate-overdue-requests',
      description:
        'Find ServiceDesk Plus requests past their SLA due-by time and escalate them with a higher priority and an owner.',
      content:
        '# Escalate Overdue Requests\n\nCatch requests that are breaching or about to breach their SLA.\n\n## Steps\n1. List Requests with search criteria limiting the result to open statuses, sorted on due_by_time ascending so the soonest-due come first. Page with row_count (max 100) and start_index if the queue is large.\n2. Compare each due_by_time.value — epoch milliseconds as a string — against the current time to separate already-breached requests from ones due shortly.\n3. For each breached request, Update Request to raise the priority and set the escalation owner via technician email or group.\n4. Add Request Note recording that it was escalated, how overdue it was, and who now owns it.\n\n## Output\nA list of escalated requests with display_id, how far past due each was, the new priority, and the new owner. Include a separate at-risk list of requests due soon but not yet breached.',
    },
    {
      name: 'deflect-with-knowledge-base',
      description:
        'Search ServiceDesk Plus solutions for an answer to an incoming request and reply with it as a requester-visible note.',
      content:
        '# Deflect a Request with the Knowledge Base\n\nAnswer a request from an existing solution instead of queueing it for an agent.\n\n## Steps\n1. Get Request and read its subject and description to work out what is actually being asked.\n2. List Solutions with search criteria matching the key terms against title or keywords. Try more than one phrasing before concluding nothing exists.\n3. Get Solution on the best candidate and read its description in full — confirm it answers this request rather than a superficially similar one.\n4. If it fits, Add Request Note quoting the relevant steps with "visible to requester" on, and Update Request to move the status toward resolution per the portal\'s workflow.\n5. If nothing fits, leave the request open and assign it to the service desk group instead of guessing.\n\n## Output\nThe request display_id, the solution ID used (or a statement that no solution matched), and the note that was posted. Never mark a request resolved on a solution you have not actually read.',
    },
    {
      name: 'daily-service-desk-digest',
      description:
        'Summarize the current ServiceDesk Plus queue by status, priority and technician into a digest for the team.',
      content:
        '# Daily Service Desk Digest\n\nProduce a morning read on where the request queue stands.\n\n## Steps\n1. List Requests with search criteria for the statuses you care about, setting get_total_count so the digest can report the true size of the queue rather than the page size.\n2. Page with row_count and start_index until the queue is covered, watching has_more_rows in list_info.\n3. Group the results by status, priority and technician, and compute counts for each group.\n4. Flag unassigned requests, requests past due_by_time, and anything untouched since created_time.\n\n## Output\nA digest with counts by status and priority, load per technician, and a callout list of unassigned and overdue requests by display_id. State the search criteria used so the numbers are reproducible.',
    },
    {
      name: 'raise-problem-from-recurring-requests',
      description:
        'Spot repeated ServiceDesk Plus requests with a shared cause and open a problem record linking them.',
      content:
        '# Raise a Problem from Recurring Requests\n\nTurn a cluster of similar incidents into a tracked problem.\n\n## Steps\n1. List Requests created in the recent window using a created_time search criterion, paging until covered.\n2. Group them by category and subcategory, and look for a cluster large enough to indicate a common cause rather than coincidence.\n3. List Problems to check whether an open problem already covers that cluster — if one does, add to it instead of opening a duplicate.\n4. Create Problem with a title naming the symptom, a description of the pattern and its impact, and the matching category and group.\n5. Add Problem Note listing the contributing request display_ids so the link back to the incidents is recorded.\n\n## Output\nThe problem ID created (or the existing one matched), the cluster it covers, and the request display_ids attributed to it. State the time window and grouping used.',
    },
    {
      name: 'publish-solution-from-resolved-request',
      description:
        'Turn a resolved ServiceDesk Plus request and its notes into a knowledge base solution.',
      content:
        '# Publish a Solution from a Resolved Request\n\nCapture a fix while the detail is still on the ticket.\n\n## Steps\n1. Get Request for the resolved request and List Request Notes to read the full working history, not just the closing note.\n2. Distil the symptom, the cause and the steps that actually fixed it. Drop customer-specific details such as names, asset tags and internal hostnames.\n3. List Solutions first to confirm no article already covers this, so the knowledge base does not accumulate near-duplicates.\n4. Create Solution with a title phrased the way a requester would search for it, the write-up as the content, an existing topic name, and keywords covering the phrasings people actually use.\n5. Leave "visible to requesters" off unless the portal has approved the article — ServiceDesk Plus only honours that flag once the approval status is Approved.\n\n## Output\nThe solution ID and title created, the source request display_id, and a note on anything omitted as customer-specific that a human should check before publishing.',
    },
    {
      name: 'reclaim-assets-on-offboarding',
      description:
        'Find ServiceDesk Plus assets assigned to a departing employee and move them to a reclaim state with a request to collect them.',
      content:
        "# Reclaim Assets on Offboarding\n\nMake sure hardware comes back when someone leaves.\n\n## Steps\n1. List Assets with a search criterion matching the departing user, paging until covered.\n2. Get Asset on each result to confirm its current state and assignment before changing anything — a stale list row is not proof of who holds it today.\n3. Update Asset for each one to the portal's reclaim state, with a state change comment naming the offboarding date and the ticket driving it.\n4. Create Request for IT to physically collect the hardware, listing every asset name and tag in the description so nothing is missed.\n\n## Output\nThe assets found with name, asset_tag and serial_number, the state each was moved to, and the request display_id raised for collection. Flag any asset you could not update and why.",
    },
    {
      name: 'prepare-change-calendar',
      description:
        'Summarize upcoming ServiceDesk Plus changes into a weekly calendar with owners and scheduling conflicts.',
      content:
        '# Prepare the Change Calendar\n\nGive the change advisory board a readable week ahead.\n\n## Steps\n1. List Changes with a search criterion on scheduled_start_time covering the coming week, paging until covered.\n2. For anything needing detail, Get Change to read its stage, approval status, roll-out plan and owner.\n3. Group by change type and by day, and read scheduled_start_time and scheduled_end_time as epoch milliseconds to find overlapping windows on the same systems.\n4. Flag emergency changes, changes still awaiting approval, and any window that collides with another.\n\n## Output\nA day-by-day calendar with change display_id, title, type, owner and window. Follow it with a conflicts section and an approvals-outstanding section. State the date range used.',
    },
  ],
} as const satisfies BlockMeta
