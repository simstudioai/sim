import { CheckrIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const CANDIDATE_ID_REQUIRED_OPS = [
  'get_candidate',
  'update_candidate',
  'delete_candidate_pii',
  'create_invitation',
  'create_report',
  'create_subscription',
  'create_continuous_check',
  'list_continuous_checks',
  'list_candidate_documents',
]

const REPORT_ID_OPS = [
  'get_report',
  'update_report',
  'complete_report',
  'get_report_eta',
  'get_report_progressive_status',
  'apply_report_review_action',
  'get_report_tags',
  'add_report_tag',
  'set_report_tags',
  'remove_report_tag',
  'list_adverse_items',
  'list_assessments',
  'list_verifications',
  'list_report_addresses',
  'create_adverse_action',
  'list_adverse_actions',
]

const CANDIDATE_WRITE_OPS = ['create_candidate', 'update_candidate']

const ORDER_OPS = ['create_invitation', 'create_report', 'create_subscription']

const HIERARCHY_OPS = [
  'create_invitation',
  'create_report',
  'create_subscription',
  'update_subscription',
  'create_continuous_check',
]

const PAGINATED_OPS = [
  'list_candidates',
  'list_invitations',
  'list_packages',
  'list_geos',
  'list_nodes',
  'list_programs',
  'list_subscriptions',
  'list_users',
  'list_report_addresses',
]

const OPTIONAL_BOOLEAN_OPTIONS = [
  { label: 'Not set', id: '' },
  { label: 'Yes', id: 'true' },
  { label: 'No', id: 'false' },
]

const DATE_WAND = {
  enabled: true,
  prompt:
    'Generate a date in YYYY-MM-DD format based on the user description. Return ONLY the date, with no explanation.',
  generationType: 'timestamp',
} as const

const WORK_LOCATIONS_WAND = {
  enabled: true,
  prompt:
    'Generate a JSON array of Checkr work locations from the user description. Each item is an object with "state" (two-letter code, required), and optional "country" (ISO 3166-1 alpha-2, defaults to US) and "city". Return ONLY the JSON array.',
  generationType: 'json-array',
} as const

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return Number(value)
}

export const CheckrBlock: BlockConfig = {
  type: 'checkr',
  name: 'Checkr',
  description: 'Run and manage background checks with Checkr',
  longDescription:
    'Integrate Checkr into the workflow. Create and update candidates, send background check invitations, order and upgrade reports, read screening results and assessments, manage report tags, run the adverse action process, schedule recurring checks and continuous monitoring, look up packages, geos, nodes, programs, documents, and users, and react to report, invitation, candidate, verification, adverse action, and continuous check webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/checkr',
  category: 'tools',
  integrationType: IntegrationType.HR,
  bgColor: '#009BB5',
  icon: CheckrIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Checkr',
    sentences: {
      byOperation: {
        list_candidates: [
          'List candidates',
          { text: ', with email', field: 'email' },
          { text: ', named', field: 'fullName' },
        ],
        get_candidate: [{ text: 'Read candidate', field: 'candidateId', core: true }],
        create_candidate: [
          { text: 'Create candidate with email', field: 'email', core: true },
          { text: ', named', field: 'firstName' },
        ],
        update_candidate: [{ text: 'Update candidate', field: 'candidateId', core: true }],
        delete_candidate_pii: [
          { text: 'Remove personal data of candidate', field: 'candidateId', core: true },
        ],
        create_invitation: [
          { text: 'Invite candidate', field: 'candidateId', core: true },
          { text: 'to package', field: 'package', core: true },
        ],
        list_invitations: [
          'List invitations',
          { text: ', for candidate', field: 'candidateId' },
          { text: ', with status', field: 'invitationStatus' },
        ],
        get_invitation: [{ text: 'Read invitation', field: 'invitationId', core: true }],
        cancel_invitation: [{ text: 'Cancel invitation', field: 'invitationId', core: true }],
        create_report: [
          { text: 'Order', field: 'package', core: true },
          { text: 'report for candidate', field: 'candidateId', core: true },
        ],
        get_report: [{ text: 'Read report', field: 'reportId', core: true }],
        update_report: [
          { text: 'Update report', field: 'reportId', core: true },
          { text: 'to package', field: 'package' },
          { text: 'as', field: 'reportAdjudication' },
        ],
        complete_report: [{ text: 'Complete report', field: 'reportId', core: true }],
        get_report_eta: [
          { text: 'Read completion estimate for report', field: 'reportId', core: true },
        ],
        get_report_progressive_status: [
          { text: 'Read checkpoint status of report', field: 'reportId', core: true },
        ],
        apply_report_review_action: [
          { text: 'Set review decision on report', field: 'reportId', core: true },
          { text: 'to', field: 'decision', core: true },
        ],
        get_report_tags: [{ text: 'List tags on report', field: 'reportId', core: true }],
        add_report_tag: [
          { text: 'Tag report', field: 'reportId', core: true },
          { text: 'with', field: 'tag', core: true },
        ],
        set_report_tags: [
          { text: 'Set tags on report', field: 'reportId', core: true },
          { text: 'to', field: 'tags' },
        ],
        remove_report_tag: [
          { text: 'Remove tag', field: 'tag', core: true },
          { text: 'from report', field: 'reportId', core: true },
        ],
        list_adverse_items: [
          { text: 'List adverse items on report', field: 'reportId', core: true },
        ],
        list_assessments: [{ text: 'List assessments of report', field: 'reportId', core: true }],
        list_verifications: [
          { text: 'List verifications on report', field: 'reportId', core: true },
        ],
        get_verification: [{ text: 'Read verification', field: 'verificationId', core: true }],
        list_report_addresses: [
          { text: 'List addresses found for report', field: 'reportId', core: true },
        ],
        create_adverse_action: [
          { text: 'Start adverse action on report', field: 'reportId', core: true },
        ],
        list_adverse_actions: [
          { text: 'List adverse actions on report', field: 'reportId', core: true },
        ],
        get_adverse_action: [{ text: 'Read adverse action', field: 'adverseActionId', core: true }],
        cancel_adverse_action: [
          { text: 'Cancel adverse action', field: 'adverseActionId', core: true },
        ],
        get_screening: [
          { text: 'Read', field: 'screeningType', core: true },
          { text: 'result', field: 'screeningId', core: true },
        ],
        list_packages: ['List packages'],
        get_package: [{ text: 'Read package', field: 'packageId', core: true }],
        list_geos: ['List geos', { text: 'named', field: 'name' }, { text: 'in', field: 'state' }],
        get_geo: [{ text: 'Read geo', field: 'geoId', core: true }],
        create_geo: [
          { text: 'Create geo', field: 'name', core: true },
          { text: 'in', field: 'state', core: true },
        ],
        update_geo: [
          { text: 'Set city of geo', field: 'geoId', core: true },
          { text: 'to', field: 'city', core: true },
        ],
        delete_geo: [{ text: 'Delete geo', field: 'geoId', core: true }],
        list_nodes: ['List hierarchy nodes'],
        get_node: [{ text: 'Read node', field: 'nodeCustomId', core: true }],
        list_programs: ['List programs', { text: 'named', field: 'name' }],
        get_program: [{ text: 'Read program', field: 'programId', core: true }],
        list_counties: ['List counties', { text: 'in states', field: 'states' }],
        create_subscription: [
          { text: 'Schedule recurring', field: 'package', core: true },
          { text: 'checks for candidate', field: 'candidateId', core: true },
        ],
        list_subscriptions: [
          'List subscriptions',
          { text: ', for candidate', field: 'candidateId' },
          { text: ', with status', field: 'subscriptionStatus' },
        ],
        get_subscription: [{ text: 'Read subscription', field: 'subscriptionId', core: true }],
        update_subscription: [{ text: 'Update subscription', field: 'subscriptionId', core: true }],
        cancel_subscription: [{ text: 'Cancel subscription', field: 'subscriptionId', core: true }],
        create_continuous_check: [
          { text: 'Enroll candidate', field: 'candidateId', core: true },
          { text: 'in continuous', field: 'continuousCheckType', core: true },
          'monitoring',
        ],
        list_continuous_checks: [
          { text: 'List continuous checks for candidate', field: 'candidateId', core: true },
        ],
        get_continuous_check: [
          { text: 'Read continuous check', field: 'continuousCheckId', core: true },
        ],
        update_continuous_check: [
          { text: 'Update continuous check', field: 'continuousCheckId', core: true },
        ],
        cancel_continuous_check: [
          { text: 'Cancel continuous check', field: 'continuousCheckId', core: true },
        ],
        list_candidate_documents: [
          { text: 'List documents of candidate', field: 'candidateId', core: true },
        ],
        get_document: [{ text: 'Read document', field: 'documentId', core: true }],
        get_account: ['Read account details'],
        list_users: ['List account users'],
      },
    },
  },

  triggers: {
    enabled: true,
    available: [
      'checkr_report_completed',
      'checkr_report_created',
      'checkr_report_updated',
      'checkr_report_upgraded',
      'checkr_report_suspended',
      'checkr_report_resumed',
      'checkr_report_paused',
      'checkr_report_canceled',
      'checkr_report_disputed',
      'checkr_report_dispute_completed',
      'checkr_report_engaged',
      'checkr_invitation_created',
      'checkr_invitation_completed',
      'checkr_invitation_expired',
      'checkr_invitation_deleted',
      'checkr_candidate_created',
      'checkr_candidate_updated',
      'checkr_adverse_action_created',
      'checkr_adverse_action_completed',
      'checkr_adverse_action_canceled',
      'checkr_adverse_action_notice_not_delivered',
      'checkr_verification_created',
      'checkr_verification_completed',
      'checkr_verification_processed',
      'checkr_continuous_check_subscription_error',
      'checkr_continuous_check_confirmation_required',
      'checkr_report_pre_adverse_action',
      'checkr_report_post_adverse_action',
      'checkr_adverse_action_paused',
      'checkr_adverse_action_resumed',
      'checkr_webhook',
    ],
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Candidates', id: 'list_candidates' },
        { label: 'Get Candidate', id: 'get_candidate' },
        { label: 'Create Candidate', id: 'create_candidate' },
        { label: 'Update Candidate', id: 'update_candidate' },
        { label: 'Delete Candidate PII', id: 'delete_candidate_pii' },
        { label: 'Invite Candidate', id: 'create_invitation' },
        { label: 'List Invitations', id: 'list_invitations' },
        { label: 'Get Invitation', id: 'get_invitation' },
        { label: 'Cancel Invitation', id: 'cancel_invitation' },
        { label: 'Order Report', id: 'create_report' },
        { label: 'Get Report', id: 'get_report' },
        { label: 'Update Report', id: 'update_report' },
        { label: 'Complete Report', id: 'complete_report' },
        { label: 'Get Report ETA', id: 'get_report_eta' },
        { label: 'Get Report Checkpoints', id: 'get_report_progressive_status' },
        { label: 'Apply Report Review Action', id: 'apply_report_review_action' },
        { label: 'Get Report Tags', id: 'get_report_tags' },
        { label: 'Add Report Tag', id: 'add_report_tag' },
        { label: 'Set Report Tags', id: 'set_report_tags' },
        { label: 'Remove Report Tag', id: 'remove_report_tag' },
        { label: 'List Adverse Items', id: 'list_adverse_items' },
        { label: 'List Assessments', id: 'list_assessments' },
        { label: 'List Verifications', id: 'list_verifications' },
        { label: 'Get Verification', id: 'get_verification' },
        { label: 'List Report Addresses', id: 'list_report_addresses' },
        { label: 'Get Screening', id: 'get_screening' },
        { label: 'Create Adverse Action', id: 'create_adverse_action' },
        { label: 'List Adverse Actions', id: 'list_adverse_actions' },
        { label: 'Get Adverse Action', id: 'get_adverse_action' },
        { label: 'Cancel Adverse Action', id: 'cancel_adverse_action' },
        { label: 'List Packages', id: 'list_packages' },
        { label: 'Get Package', id: 'get_package' },
        { label: 'List Geos', id: 'list_geos' },
        { label: 'Get Geo', id: 'get_geo' },
        { label: 'Create Geo', id: 'create_geo' },
        { label: 'Update Geo', id: 'update_geo' },
        { label: 'Delete Geo', id: 'delete_geo' },
        { label: 'List Nodes', id: 'list_nodes' },
        { label: 'Get Node', id: 'get_node' },
        { label: 'List Programs', id: 'list_programs' },
        { label: 'Get Program', id: 'get_program' },
        { label: 'List Counties', id: 'list_counties' },
        { label: 'Schedule Recurring Check', id: 'create_subscription' },
        { label: 'List Subscriptions', id: 'list_subscriptions' },
        { label: 'Get Subscription', id: 'get_subscription' },
        { label: 'Update Subscription', id: 'update_subscription' },
        { label: 'Cancel Subscription', id: 'cancel_subscription' },
        { label: 'Create Continuous Check', id: 'create_continuous_check' },
        { label: 'List Continuous Checks', id: 'list_continuous_checks' },
        { label: 'Get Continuous Check', id: 'get_continuous_check' },
        { label: 'Update Continuous Check', id: 'update_continuous_check' },
        { label: 'Cancel Continuous Check', id: 'cancel_continuous_check' },
        { label: 'List Candidate Documents', id: 'list_candidate_documents' },
        { label: 'Get Document', id: 'get_document' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'List Users', id: 'list_users' },
      ],
      value: () => 'list_candidates',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Checkr secret API key',
      password: true,
    },
    {
      id: 'candidateId',
      title: 'Candidate ID',
      type: 'short-input',
      placeholder: 'e44aa283528e6fde7d542194',
      condition: {
        field: 'operation',
        value: [...CANDIDATE_ID_REQUIRED_OPS, 'list_invitations', 'list_subscriptions'],
      },
      required: { field: 'operation', value: CANDIDATE_ID_REQUIRED_OPS },
    },
    {
      id: 'reportId',
      title: 'Report ID',
      type: 'short-input',
      placeholder: '4722c07dd9a10c3985ae432a',
      condition: { field: 'operation', value: REPORT_ID_OPS },
      required: { field: 'operation', value: REPORT_ID_OPS },
    },
    {
      id: 'invitationId',
      title: 'Invitation ID',
      type: 'short-input',
      placeholder: '16241770f7f7be1c57c85176',
      condition: { field: 'operation', value: ['get_invitation', 'cancel_invitation'] },
      required: { field: 'operation', value: ['get_invitation', 'cancel_invitation'] },
    },
    {
      id: 'adverseActionId',
      title: 'Adverse Action ID',
      type: 'short-input',
      placeholder: '5c4f46eb805e59e228baacdd',
      condition: { field: 'operation', value: ['get_adverse_action', 'cancel_adverse_action'] },
      required: { field: 'operation', value: ['get_adverse_action', 'cancel_adverse_action'] },
    },
    {
      id: 'verificationId',
      title: 'Verification ID',
      type: 'short-input',
      placeholder: '5c4f46eb805e59e228baacdd',
      condition: { field: 'operation', value: 'get_verification' },
      required: { field: 'operation', value: 'get_verification' },
    },
    {
      id: 'deletionContactEmail',
      title: 'Requester Email',
      type: 'short-input',
      placeholder: 'Email of the person requesting the removal',
      condition: { field: 'operation', value: 'delete_candidate_pii' },
      required: { field: 'operation', value: 'delete_candidate_pii' },
    },
    {
      id: 'deletionContactFirstName',
      title: 'Requester First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: 'delete_candidate_pii' },
      mode: 'advanced',
    },
    {
      id: 'deletionContactLastName',
      title: 'Requester Last Name',
      type: 'short-input',
      placeholder: 'Smith',
      condition: { field: 'operation', value: 'delete_candidate_pii' },
      mode: 'advanced',
    },
    {
      id: 'screeningType',
      title: 'Screening Type',
      type: 'dropdown',
      options: [
        { label: 'SSN Trace', id: 'ssn_trace' },
        { label: 'Sex Offender Registry Search', id: 'sex_offender_search' },
        { label: 'Global Watchlist Search', id: 'global_watchlist_search' },
        { label: 'National Criminal Search', id: 'national_criminal_search' },
        { label: 'County Criminal Search', id: 'county_criminal_search' },
        { label: 'State Criminal Search', id: 'state_criminal_search' },
        { label: 'Federal Criminal Search', id: 'federal_criminal_search' },
        { label: 'Federal District Criminal Search', id: 'federal_district_criminal_search' },
        { label: 'Federal Civil Search', id: 'federal_civil_search' },
        { label: 'Federal District Civil Search', id: 'federal_district_civil_search' },
        { label: 'Motor Vehicle Report', id: 'motor_vehicle_report' },
        { label: 'Drug & Alcohol Clearinghouse Search', id: 'drug_alcohol_clearinghouse_search' },
        {
          label: 'FMCSA Pre-Employment Screening Program Search',
          id: 'fmcsa_pre_employment_screening_program_search',
        },
        { label: 'Education Verification', id: 'education_verification' },
        { label: 'Employment Verification', id: 'employment_verification' },
        { label: 'Personal Reference Verification', id: 'personal_reference_verification' },
        { label: 'Professional Reference Verification', id: 'professional_reference_verification' },
        { label: 'Professional License Verification', id: 'professional_license_verification' },
        { label: 'Social Media Screening', id: 'social_media_screening' },
        { label: 'FACIS Search', id: 'facis_search' },
        { label: 'Identity Data Evaluation', id: 'identity_data_evaluation' },
        { label: 'International Adverse Media Search', id: 'international_adverse_media_search' },
        { label: 'International Criminal Search', id: 'international_criminal_search' },
        {
          label: 'International Education Verification',
          id: 'international_education_verification',
        },
        {
          label: 'International Employment Verification',
          id: 'international_employment_verification',
        },
        {
          label: 'International Global Watchlist Search',
          id: 'international_global_watchlist_search',
        },
        {
          label: 'International Identity Document Validation',
          id: 'international_identity_document_validation',
        },
        { label: 'International Motor Vehicle Report', id: 'international_motor_vehicle_report' },
      ],
      value: () => 'ssn_trace',
      condition: { field: 'operation', value: 'get_screening' },
      required: { field: 'operation', value: 'get_screening' },
    },
    {
      id: 'screeningId',
      title: 'Screening ID',
      type: 'short-input',
      placeholder: 'ID from Get Report, e.g. its ssnTraceId',
      condition: { field: 'operation', value: 'get_screening' },
      required: { field: 'operation', value: 'get_screening' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'john.smith@example.com',
      condition: { field: 'operation', value: [...CANDIDATE_WRITE_OPS, 'list_candidates'] },
      required: { field: 'operation', value: 'create_candidate' },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'middleName',
      title: 'Middle Name',
      type: 'short-input',
      placeholder: 'Alfred',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'noMiddleName',
      title: 'No Middle Name',
      type: 'dropdown',
      options: OPTIONAL_BOOLEAN_OPTIONS,
      value: () => '',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Smith',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'dob',
      title: 'Date of Birth',
      type: 'short-input',
      placeholder: '1970-01-22',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'ssn',
      title: 'SSN',
      type: 'short-input',
      placeholder: '111-11-2001',
      password: true,
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'zipcode',
      title: 'Zip Code',
      type: 'short-input',
      placeholder: '90401',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '5555555555',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
    },
    {
      id: 'driverLicenseNumber',
      title: 'Driver License Number',
      type: 'short-input',
      placeholder: 'F2111655',
      condition: { field: 'operation', value: [...CANDIDATE_WRITE_OPS, 'list_candidates'] },
      mode: 'advanced',
    },
    {
      id: 'driverLicenseState',
      title: 'Driver License State',
      type: 'short-input',
      placeholder: 'CA',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'previousDriverLicenseNumber',
      title: 'Previous Driver License Number',
      type: 'short-input',
      placeholder: 'F1501739',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'previousDriverLicenseState',
      title: 'Previous Driver License State',
      type: 'short-input',
      placeholder: 'MD',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'motherMaidenName',
      title: "Mother's Maiden Name",
      type: 'short-input',
      placeholder: 'Jones',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'copyRequested',
      title: 'Copy of Report Requested',
      type: 'dropdown',
      options: OPTIONAL_BOOLEAN_OPTIONS,
      value: () => '',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'customId',
      title: 'Custom ID',
      type: 'short-input',
      placeholder: 'HRIS-27',
      condition: { field: 'operation', value: [...CANDIDATE_WRITE_OPS, 'list_candidates'] },
      mode: 'advanced',
    },
    {
      id: 'geoIds',
      title: 'Geo IDs',
      type: 'short-input',
      placeholder: 'Comma-separated geo IDs (replaces existing geos)',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{\n  "hris_id": "HRIS-27"\n}',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a flat JSON object of up to 50 string key-value pairs for Checkr candidate metadata from the user description. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'postalAddress',
      title: 'Postal Address',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "name": "John Alfred Smith",\n  "street": "123 Main Street",\n  "city": "San Francisco",\n  "state": "CA",\n  "zipcode": "94108"\n}',
      condition: { field: 'operation', value: CANDIDATE_WRITE_OPS },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object for a US postal address with keys name, street, street2 (optional), city, state (two-letter code), and zipcode from the user description. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'fullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'John Alfred Smith',
      condition: { field: 'operation', value: 'list_candidates' },
    },
    {
      id: 'candidateAdjudication',
      title: 'Adjudication',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Engaged', id: 'engaged' },
        { label: 'Pre-Adverse Action', id: 'pre_adverse_action' },
        { label: 'Post-Adverse Action', id: 'post_adverse_action' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: '2024-01-01',
      condition: { field: 'operation', value: ['list_candidates', 'list_subscriptions'] },
      mode: 'advanced',
      wandConfig: DATE_WAND,
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      placeholder: '2024-12-31',
      condition: { field: 'operation', value: ['list_candidates', 'list_subscriptions'] },
      mode: 'advanced',
      wandConfig: DATE_WAND,
    },
    {
      id: 'reportAdjudicatedAfter',
      title: 'Report Adjudicated After',
      type: 'short-input',
      placeholder: '2024-01-01',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
      wandConfig: DATE_WAND,
    },
    {
      id: 'reportAdjudicatedBefore',
      title: 'Report Adjudicated Before',
      type: 'short-input',
      placeholder: '2024-12-31',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
      wandConfig: DATE_WAND,
    },
    {
      id: 'reportAdjudicatorEmail',
      title: 'Report Adjudicator Email',
      type: 'short-input',
      placeholder: 'adjudicator@example.com',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
    },
    {
      id: 'reportRevisedAfter',
      title: 'Report Revised After',
      type: 'short-input',
      placeholder: '2024-01-01',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
      wandConfig: DATE_WAND,
    },
    {
      id: 'reportRevisedBefore',
      title: 'Report Revised Before',
      type: 'short-input',
      placeholder: '2024-12-31',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
      wandConfig: DATE_WAND,
    },
    {
      id: 'package',
      title: 'Package',
      type: 'short-input',
      placeholder: 'Package slug, e.g. driver_pro',
      condition: {
        field: 'operation',
        value: [...ORDER_OPS, 'update_report', 'update_subscription'],
      },
      required: { field: 'operation', value: ORDER_OPS },
    },
    {
      id: 'reportAdjudication',
      title: 'Adjudication',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Engaged', id: 'engaged' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_report' },
    },
    {
      id: 'decision',
      title: 'Decision',
      type: 'dropdown',
      options: [
        { label: 'Continue', id: 'continue' },
        { label: 'Skip remaining', id: 'skip_remaining' },
      ],
      value: () => 'continue',
      condition: { field: 'operation', value: 'apply_report_review_action' },
      required: { field: 'operation', value: 'apply_report_review_action' },
    },
    {
      id: 'tag',
      title: 'Tag',
      type: 'short-input',
      placeholder: 'To Review',
      condition: { field: 'operation', value: ['add_report_tag', 'remove_report_tag'] },
      required: { field: 'operation', value: ['add_report_tag', 'remove_report_tag'] },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags, e.g. West Coast, To Review ([] clears all)',
      condition: { field: 'operation', value: 'set_report_tags' },
      required: { field: 'operation', value: 'set_report_tags' },
    },
    {
      id: 'reportTags',
      title: 'Report Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags, e.g. West Coast, To Review',
      condition: { field: 'operation', value: ['create_invitation', 'create_report'] },
      mode: 'advanced',
    },
    {
      id: 'selfDisclosures',
      title: 'Self Disclosures',
      type: 'code',
      language: 'json',
      placeholder:
        '[\n  {\n    "description": "Candidate statement",\n    "date": "2019-11-01",\n    "location": { "county": "BOULDER", "state": "CO" }\n  }\n]',
      condition: { field: 'operation', value: 'create_report' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Checkr self-disclosures from the user description. Each item has "description", "date" (YYYY-MM-DD), "location" with "county" (uppercase county name) and two-letter "state", and optional "offense_level", "offense_category", "sentence", and "time_served". Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'node',
      title: 'Node',
      type: 'short-input',
      placeholder: 'Node custom ID (required for hierarchy-enabled accounts)',
      condition: { field: 'operation', value: HIERARCHY_OPS },
      mode: 'advanced',
    },
    {
      id: 'continuousCheckNode',
      title: 'Node',
      type: 'short-input',
      placeholder: 'New node custom ID',
      condition: { field: 'operation', value: 'update_continuous_check' },
    },
    {
      id: 'workLocations',
      title: 'Work Locations',
      type: 'code',
      language: 'json',
      placeholder: '[\n  { "country": "US", "state": "CA", "city": "San Francisco" }\n]',
      condition: { field: 'operation', value: [...HIERARCHY_OPS, 'create_candidate'] },
      mode: 'advanced',
      wandConfig: WORK_LOCATIONS_WAND,
    },
    {
      id: 'continuousCheckWorkLocations',
      title: 'Work Locations',
      type: 'code',
      language: 'json',
      placeholder: '[\n  { "country": "US", "state": "CA", "city": "San Francisco" }\n]',
      condition: { field: 'operation', value: 'update_continuous_check' },
      wandConfig: WORK_LOCATIONS_WAND,
    },
    {
      id: 'invitationStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Pending', id: 'pending' },
        { label: 'Completed', id: 'completed' },
        { label: 'Expired', id: 'expired' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_invitations' },
    },
    {
      id: 'includeDeleted',
      title: 'Include Canceled',
      type: 'switch',
      condition: { field: 'operation', value: 'get_invitation' },
      mode: 'advanced',
    },
    {
      id: 'adverseItemIds',
      title: 'Adverse Item IDs',
      type: 'short-input',
      placeholder: 'Comma-separated IDs from List Adverse Items',
      condition: { field: 'operation', value: 'create_adverse_action' },
      required: { field: 'operation', value: 'create_adverse_action' },
    },
    {
      id: 'postNoticeScheduledAt',
      title: 'Post-Notice Send Time',
      type: 'short-input',
      placeholder: '2024-10-07T12:34:00Z (defaults to 7 days after creation)',
      condition: { field: 'operation', value: 'create_adverse_action' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp (e.g. 2024-10-07T12:34:00Z) based on the user description. Return ONLY the timestamp.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'context',
      title: 'Context',
      type: 'short-input',
      placeholder: 'Optional scoping identifier, e.g. context-1',
      condition: { field: 'operation', value: ['create_adverse_action', 'list_adverse_actions'] },
      mode: 'advanced',
    },
    {
      id: 'medium',
      title: 'Delivery Medium',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "email": { "priority": 1, "required": true },\n  "postal": { "priority": 0, "required": false }\n}',
      condition: { field: 'operation', value: 'create_adverse_action' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Checkr adverse action delivery medium JSON object from the user description, with optional "email" and "postal" keys, each { "priority": number, "required": boolean } where priority 1 sends through that medium. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'packageId',
      title: 'Package ID',
      type: 'short-input',
      placeholder: 'e44aa283528e6fde7d542194',
      condition: { field: 'operation', value: 'get_package' },
      required: { field: 'operation', value: 'get_package' },
    },
    {
      id: 'geoId',
      title: 'Geo ID',
      type: 'short-input',
      placeholder: 'e44aa283528e6fde7d542194',
      condition: { field: 'operation', value: ['get_geo', 'update_geo', 'delete_geo'] },
      required: { field: 'operation', value: ['get_geo', 'update_geo', 'delete_geo'] },
    },
    {
      id: 'filterGeoId',
      title: 'Geo ID',
      type: 'short-input',
      placeholder: 'Only candidates assigned to this geo',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'e.g. San Francisco or Driver Program',
      condition: { field: 'operation', value: ['create_geo', 'list_geos', 'list_programs'] },
      required: { field: 'operation', value: 'create_geo' },
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      placeholder: 'CA',
      condition: { field: 'operation', value: ['create_geo', 'list_geos'] },
      required: { field: 'operation', value: 'create_geo' },
    },
    {
      id: 'states',
      title: 'State FIPS Codes',
      type: 'short-input',
      placeholder: 'Comma-separated FIPS codes, e.g. 08,06 (empty for all states)',
      condition: { field: 'operation', value: 'list_counties' },
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the US states in the user description to their two-digit state FIPS codes, comma-separated (e.g. California and Colorado -> 06,08). Return ONLY the comma-separated codes.',
      },
    },
    {
      id: 'city',
      title: 'City',
      type: 'short-input',
      placeholder: 'San Francisco',
      condition: { field: 'operation', value: ['create_geo', 'update_geo'] },
      required: { field: 'operation', value: 'update_geo' },
    },
    {
      id: 'nodeCustomId',
      title: 'Node Custom ID',
      type: 'short-input',
      placeholder: 'zpy8orej4r614ize',
      condition: { field: 'operation', value: 'get_node' },
      required: { field: 'operation', value: 'get_node' },
    },
    {
      id: 'includePackages',
      title: 'Include Packages',
      type: 'switch',
      condition: { field: 'operation', value: ['list_nodes', 'get_node'] },
      mode: 'advanced',
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Created At', id: 'created_at' },
        { label: 'Custom ID', id: 'custom_id' },
      ],
      value: () => 'created_at',
      condition: { field: 'operation', value: 'list_nodes' },
      mode: 'advanced',
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: 'list_nodes' },
      mode: 'advanced',
    },
    {
      id: 'programId',
      title: 'Program ID',
      type: 'short-input',
      placeholder: '00166f9ff39ec7b453adfaec',
      condition: { field: 'operation', value: 'get_program' },
      required: { field: 'operation', value: 'get_program' },
    },
    {
      id: 'filterProgramId',
      title: 'Program ID',
      type: 'short-input',
      placeholder: 'Only candidates in this program',
      condition: { field: 'operation', value: 'list_candidates' },
      mode: 'advanced',
    },
    {
      id: 'subscriptionId',
      title: 'Subscription ID',
      type: 'short-input',
      placeholder: 'e44aa283528e6fde7d542194',
      condition: {
        field: 'operation',
        value: ['get_subscription', 'update_subscription', 'cancel_subscription'],
      },
      required: {
        field: 'operation',
        value: ['get_subscription', 'update_subscription', 'cancel_subscription'],
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: '2024-06-10',
      condition: { field: 'operation', value: ['create_subscription', 'update_subscription'] },
      required: { field: 'operation', value: 'create_subscription' },
      wandConfig: DATE_WAND,
    },
    {
      id: 'intervalCount',
      title: 'Repeat Every',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: ['create_subscription', 'update_subscription'] },
    },
    {
      id: 'intervalUnit',
      title: 'Repeat Unit',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Day', id: 'day' },
        { label: 'Week', id: 'week' },
        { label: 'Month', id: 'month' },
        { label: 'Year', id: 'year' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['create_subscription', 'update_subscription'] },
    },
    {
      id: 'subscriptionStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Active', id: 'active' },
        { label: 'Inactive', id: 'inactive' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_subscriptions' },
    },
    {
      id: 'continuousCheckId',
      title: 'Continuous Check ID',
      type: 'short-input',
      placeholder: 'd56cdf24dca36bd1cb65aebe',
      condition: {
        field: 'operation',
        value: ['get_continuous_check', 'update_continuous_check', 'cancel_continuous_check'],
      },
      required: {
        field: 'operation',
        value: ['get_continuous_check', 'update_continuous_check', 'cancel_continuous_check'],
      },
    },
    {
      id: 'continuousCheckType',
      title: 'Check Type',
      type: 'dropdown',
      options: [
        { label: 'Criminal', id: 'criminal' },
        { label: 'Motor Vehicle (MVR)', id: 'mvr' },
      ],
      value: () => 'criminal',
      condition: { field: 'operation', value: 'create_continuous_check' },
      required: { field: 'operation', value: 'create_continuous_check' },
    },
    {
      id: 'mvrEnrollmentType',
      title: 'MVR Enrollment Type',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Standard', id: 'standard' },
        { label: 'Commercial', id: 'commercial' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: 'create_continuous_check',
        and: { field: 'continuousCheckType', value: 'mvr' },
      },
      mode: 'advanced',
    },
    {
      id: 'documentTypes',
      title: 'Document Types',
      type: 'short-input',
      placeholder: 'Comma-separated types, e.g. driver_license, consent',
      condition: { field: 'operation', value: 'list_candidate_documents' },
      mode: 'advanced',
    },
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      placeholder: 'e44aa283528e6fde7d542194',
      condition: { field: 'operation', value: 'get_document' },
      required: { field: 'operation', value: 'get_document' },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Defaults to 1',
      condition: { field: 'operation', value: PAGINATED_OPS },
      mode: 'advanced',
    },
    {
      id: 'perPage',
      title: 'Per Page',
      type: 'short-input',
      placeholder: '0 to 100, defaults to 25',
      condition: { field: 'operation', value: PAGINATED_OPS },
      mode: 'advanced',
    },
    ...getTrigger('checkr_report_completed').subBlocks,
    ...getTrigger('checkr_report_created').subBlocks,
    ...getTrigger('checkr_report_updated').subBlocks,
    ...getTrigger('checkr_report_upgraded').subBlocks,
    ...getTrigger('checkr_report_suspended').subBlocks,
    ...getTrigger('checkr_report_resumed').subBlocks,
    ...getTrigger('checkr_report_paused').subBlocks,
    ...getTrigger('checkr_report_canceled').subBlocks,
    ...getTrigger('checkr_report_disputed').subBlocks,
    ...getTrigger('checkr_report_dispute_completed').subBlocks,
    ...getTrigger('checkr_report_engaged').subBlocks,
    ...getTrigger('checkr_invitation_created').subBlocks,
    ...getTrigger('checkr_invitation_completed').subBlocks,
    ...getTrigger('checkr_invitation_expired').subBlocks,
    ...getTrigger('checkr_invitation_deleted').subBlocks,
    ...getTrigger('checkr_candidate_created').subBlocks,
    ...getTrigger('checkr_candidate_updated').subBlocks,
    ...getTrigger('checkr_adverse_action_created').subBlocks,
    ...getTrigger('checkr_adverse_action_completed').subBlocks,
    ...getTrigger('checkr_adverse_action_canceled').subBlocks,
    ...getTrigger('checkr_adverse_action_notice_not_delivered').subBlocks,
    ...getTrigger('checkr_verification_created').subBlocks,
    ...getTrigger('checkr_verification_completed').subBlocks,
    ...getTrigger('checkr_verification_processed').subBlocks,
    ...getTrigger('checkr_continuous_check_subscription_error').subBlocks,
    ...getTrigger('checkr_continuous_check_confirmation_required').subBlocks,
    ...getTrigger('checkr_report_pre_adverse_action').subBlocks,
    ...getTrigger('checkr_report_post_adverse_action').subBlocks,
    ...getTrigger('checkr_adverse_action_paused').subBlocks,
    ...getTrigger('checkr_adverse_action_resumed').subBlocks,
    ...getTrigger('checkr_webhook').subBlocks,
  ],

  tools: {
    access: [
      'checkr_add_report_tag',
      'checkr_apply_report_review_action',
      'checkr_cancel_adverse_action',
      'checkr_cancel_continuous_check',
      'checkr_cancel_invitation',
      'checkr_cancel_subscription',
      'checkr_complete_report',
      'checkr_create_adverse_action',
      'checkr_create_candidate',
      'checkr_create_continuous_check',
      'checkr_create_geo',
      'checkr_create_invitation',
      'checkr_create_report',
      'checkr_create_subscription',
      'checkr_delete_candidate_pii',
      'checkr_delete_geo',
      'checkr_get_account',
      'checkr_get_adverse_action',
      'checkr_get_candidate',
      'checkr_get_continuous_check',
      'checkr_get_document',
      'checkr_get_geo',
      'checkr_get_invitation',
      'checkr_get_node',
      'checkr_get_package',
      'checkr_get_program',
      'checkr_get_report',
      'checkr_get_report_eta',
      'checkr_get_report_progressive_status',
      'checkr_get_report_tags',
      'checkr_get_screening',
      'checkr_get_subscription',
      'checkr_get_verification',
      'checkr_list_adverse_actions',
      'checkr_list_adverse_items',
      'checkr_list_assessments',
      'checkr_list_candidate_documents',
      'checkr_list_candidates',
      'checkr_list_continuous_checks',
      'checkr_list_counties',
      'checkr_list_geos',
      'checkr_list_invitations',
      'checkr_list_nodes',
      'checkr_list_packages',
      'checkr_list_programs',
      'checkr_list_report_addresses',
      'checkr_list_subscriptions',
      'checkr_list_users',
      'checkr_list_verifications',
      'checkr_remove_report_tag',
      'checkr_set_report_tags',
      'checkr_update_candidate',
      'checkr_update_continuous_check',
      'checkr_update_geo',
      'checkr_update_report',
      'checkr_update_subscription',
    ],
    config: {
      tool: (params) => `checkr_${params.operation}`,
      params: (params) => {
        const {
          candidateAdjudication,
          reportAdjudication,
          invitationStatus,
          subscriptionStatus,
          noMiddleName,
          copyRequested,
          includeDeleted,
          includePackages,
          page,
          perPage,
          intervalCount,
          reportTags,
          filterGeoId,
          filterProgramId,
          continuousCheckNode,
          continuousCheckWorkLocations,
          ...rest
        } = params
        const result: Record<string, unknown> = { ...rest }

        if (params.operation === 'create_invitation' || params.operation === 'create_report') {
          result.tags = reportTags || undefined
        }
        if (params.operation === 'list_candidates') {
          result.geoId = filterGeoId || undefined
          result.programId = filterProgramId || undefined
        }
        if (params.operation === 'update_continuous_check') {
          result.node = continuousCheckNode || undefined
          result.workLocations = continuousCheckWorkLocations || undefined
        }

        const adjudication =
          params.operation === 'update_report' ? reportAdjudication : candidateAdjudication
        if (adjudication) result.adjudication = adjudication
        const status =
          params.operation === 'list_subscriptions' ? subscriptionStatus : invitationStatus
        if (status) result.status = status

        const noMiddle = toOptionalBoolean(noMiddleName)
        if (noMiddle !== undefined) result.noMiddleName = noMiddle
        const copy = toOptionalBoolean(copyRequested)
        if (copy !== undefined) result.copyRequested = copy
        if (toOptionalBoolean(includeDeleted)) result.includeDeleted = true
        if (toOptionalBoolean(includePackages)) result.includePackages = true

        const pageNumber = toOptionalNumber(page)
        if (pageNumber !== undefined) result.page = pageNumber
        const perPageNumber = toOptionalNumber(perPage)
        if (perPageNumber !== undefined) result.perPage = perPageNumber
        const interval = toOptionalNumber(intervalCount)
        if (interval !== undefined) result.intervalCount = interval

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Checkr production secret API key' },
    candidateId: { type: 'string', description: 'Candidate ID' },
    reportId: { type: 'string', description: 'Report ID' },
    invitationId: { type: 'string', description: 'Invitation ID' },
    adverseActionId: { type: 'string', description: 'Adverse action ID' },
    verificationId: { type: 'string', description: 'Verification ID' },
    deletionContactEmail: { type: 'string', description: 'Email of the PII removal requester' },
    deletionContactFirstName: { type: 'string', description: 'First name of the requester' },
    deletionContactLastName: { type: 'string', description: 'Last name of the requester' },
    screeningType: { type: 'string', description: 'Screening type to retrieve' },
    screeningId: { type: 'string', description: 'Screening ID' },
    email: { type: 'string', description: 'Candidate email address' },
    firstName: { type: 'string', description: 'Candidate first name' },
    middleName: { type: 'string', description: 'Candidate middle name' },
    noMiddleName: { type: 'string', description: 'Whether the candidate has no middle name' },
    lastName: { type: 'string', description: 'Candidate last name' },
    dob: { type: 'string', description: 'Candidate date of birth (YYYY-MM-DD)' },
    ssn: { type: 'string', description: 'Candidate Social Security Number' },
    zipcode: { type: 'string', description: 'Candidate zip code' },
    phone: { type: 'string', description: 'Candidate phone number' },
    driverLicenseNumber: { type: 'string', description: 'Driver license number' },
    driverLicenseState: { type: 'string', description: 'Driver license issuing state' },
    previousDriverLicenseNumber: { type: 'string', description: 'Previous driver license number' },
    previousDriverLicenseState: { type: 'string', description: 'Previous driver license state' },
    motherMaidenName: { type: 'string', description: "Candidate's mother's maiden name" },
    copyRequested: { type: 'string', description: 'Whether the candidate requested a report copy' },
    customId: { type: 'string', description: 'Your own candidate ID' },
    geoIds: { type: 'string', description: 'Comma-separated geo IDs' },
    metadata: { type: 'json', description: 'Candidate metadata key-value pairs' },
    postalAddress: { type: 'json', description: 'Candidate postal address' },
    fullName: { type: 'string', description: 'Candidate full name filter' },
    candidateAdjudication: { type: 'string', description: 'Candidate adjudication filter' },
    createdAfter: { type: 'string', description: 'Created after date filter' },
    createdBefore: { type: 'string', description: 'Created before date filter' },
    reportAdjudicatedAfter: { type: 'string', description: 'Report adjudicated after filter' },
    reportAdjudicatedBefore: { type: 'string', description: 'Report adjudicated before filter' },
    reportAdjudicatorEmail: { type: 'string', description: 'Report adjudicator email filter' },
    reportRevisedAfter: { type: 'string', description: 'Report revised after filter' },
    reportRevisedBefore: { type: 'string', description: 'Report revised before filter' },
    package: { type: 'string', description: 'Package slug' },
    reportAdjudication: { type: 'string', description: 'Adjudication to set on the report' },
    decision: { type: 'string', description: 'Review action decision' },
    tag: { type: 'string', description: 'Report tag' },
    tags: { type: 'string', description: 'Comma-separated report tags' },
    reportTags: { type: 'string', description: 'Comma-separated tags for the new report' },
    filterGeoId: { type: 'string', description: 'Geo ID filter for candidates' },
    filterProgramId: { type: 'string', description: 'Program ID filter for candidates' },
    continuousCheckNode: { type: 'string', description: 'New node for the continuous check' },
    continuousCheckWorkLocations: {
      type: 'json',
      description: 'New work locations for the continuous check',
    },
    selfDisclosures: { type: 'json', description: 'Candidate self-disclosures' },
    node: { type: 'string', description: 'Hierarchy node custom ID' },
    workLocations: { type: 'json', description: 'Work locations' },
    invitationStatus: { type: 'string', description: 'Invitation status filter' },
    includeDeleted: { type: 'boolean', description: 'Include canceled invitations' },
    adverseItemIds: { type: 'string', description: 'Comma-separated adverse item IDs' },
    postNoticeScheduledAt: { type: 'string', description: 'Post-adverse action notice time' },
    context: { type: 'string', description: 'Adverse action context' },
    medium: { type: 'json', description: 'Adverse action delivery medium' },
    packageId: { type: 'string', description: 'Package ID' },
    geoId: { type: 'string', description: 'Geo ID' },
    name: { type: 'string', description: 'Geo or program name' },
    state: { type: 'string', description: 'Two-letter state' },
    city: { type: 'string', description: 'City' },
    states: { type: 'string', description: 'Comma-separated state FIPS codes' },
    nodeCustomId: { type: 'string', description: 'Node custom ID' },
    includePackages: { type: 'boolean', description: 'Include package slugs on nodes' },
    orderBy: { type: 'string', description: 'Node sort field' },
    order: { type: 'string', description: 'Node sort direction' },
    programId: { type: 'string', description: 'Program ID' },
    subscriptionId: { type: 'string', description: 'Subscription ID' },
    startDate: { type: 'string', description: 'Subscription start date' },
    intervalCount: { type: 'number', description: 'Subscription interval count' },
    intervalUnit: { type: 'string', description: 'Subscription interval unit' },
    subscriptionStatus: { type: 'string', description: 'Subscription status filter' },
    continuousCheckId: { type: 'string', description: 'Continuous check ID' },
    continuousCheckType: { type: 'string', description: 'Continuous check type' },
    mvrEnrollmentType: { type: 'string', description: 'Continuous MVR enrollment type' },
    documentTypes: { type: 'string', description: 'Comma-separated document types' },
    documentId: { type: 'string', description: 'Document ID' },
    page: { type: 'number', description: 'Page number' },
    perPage: { type: 'number', description: 'Records per page' },
  },

  outputs: {
    candidate: {
      type: 'json',
      description:
        'Candidate (id, uri, createdAt, firstName, middleName, noMiddleName, lastName, email, phone, zipcode, dob, ssn (redacted), driverLicenseNumber, driverLicenseState, copyRequested, customId, adjudication, reportIds, geoIds, postalAddress, metadata)',
    },
    candidates: {
      type: 'json',
      description:
        'Candidates [{id, email, firstName, middleName, lastName, dob, ssn (redacted), customId, adjudication, reportIds, geoIds, metadata}]',
    },
    invitation: {
      type: 'json',
      description:
        'Invitation (id, uri, invitationUrl, status, createdAt, expiresAt, completedAt, deletedAt, package, candidateId, reportId, archived, archivedInfo)',
    },
    invitations: {
      type: 'json',
      description:
        'Invitations [{id, status, invitationUrl, package, candidateId, reportId, createdAt, expiresAt, completedAt}]',
    },
    report: {
      type: 'json',
      description:
        'Report (id, uri, status, result, adjudication, assessment, package, source, candidateId, timestamps, turnaroundTime, estimatedCompletionTime, screening IDs such as ssnTraceId, countyCriminalSearchIds, motorVehicleReportId, documentIds, geoIds, drugScreening); for progressive status, only id, uri, and status',
    },
    estimateGeneratedAt: { type: 'string', description: 'Time the report ETA was generated' },
    estimatedCompletionTime: { type: 'string', description: 'Predicted report completion date' },
    progressiveContinuationStatus: {
      type: 'string',
      description: 'Whether a progressive report can still be advanced',
    },
    expiresAt: { type: 'string', description: 'Deadline for applying a review action' },
    checkpoints: {
      type: 'json',
      description:
        'Progressive checkpoints (position, name, status, productKeys, userReview with status, decision, expired, pausedAt)',
    },
    message: { type: 'string', description: 'Confirmation message for a review action' },
    tags: { type: 'json', description: 'Tag names on the report' },
    adverseItems: {
      type: 'json',
      description: 'Adverse items (id, text, assessment) that can be cited in an adverse action',
    },
    assessments: {
      type: 'json',
      description:
        'Assessments (value, createdAt, ruleset, results with rule and assessed objects)',
    },
    verifications: {
      type: 'json',
      description:
        'Verifications (id, uri, verificationType, verificationUrl, reportId, createdAt, completedAt, processedAt)',
    },
    verification: {
      type: 'json',
      description:
        'Verification (id, verificationType, verificationUrl, reportId, createdAt, completedAt, processedAt)',
    },
    addresses: {
      type: 'json',
      description: 'Addresses found for the report (name, city, state, startDate, endDate)',
    },
    screening: {
      type: 'json',
      description:
        'Screening (id, object, uri, status, result, assessment, createdAt, completedAt, turnaroundTime, estimatedCompletionTime, cancellationReason, cancellationReasonDescription, records, details)',
    },
    adverseAction: {
      type: 'json',
      description:
        'Adverse action (id, uri, status, reportId, createdAt, canceledAt, postNoticeScheduledAt, postNoticeReadyAt, individualizedAssessmentEngaged, context, delivery, adverseItems, events)',
    },
    adverseActions: {
      type: 'json',
      description:
        'Adverse actions [{id, status, reportId, createdAt, postNoticeScheduledAt, postNoticeReadyAt, delivery, adverseItems}]',
    },
    package: {
      type: 'json',
      description:
        'Package (id, uri, name, slug, price, applyUrl, createdAt, deletedAt, screenings)',
    },
    packages: {
      type: 'json',
      description: 'Packages [{id, name, slug, price, applyUrl, screenings}]',
    },
    geo: {
      type: 'json',
      description: 'Geo (id, uri, name, city, state, createdAt, deletedAt)',
    },
    geos: { type: 'json', description: 'Geos [{id, name, city, state, createdAt, deletedAt}]' },
    deleted: { type: 'boolean', description: 'Whether the geo was deleted' },
    geoId: { type: 'string', description: 'ID of the deleted geo' },
    node: {
      type: 'json',
      description: 'Hierarchy node (customId, name, tier, parentCustomId, packages)',
    },
    nodes: {
      type: 'json',
      description: 'Hierarchy nodes [{customId, name, tier, parentCustomId, packages}]',
    },
    program: {
      type: 'json',
      description: 'Program (id, name, createdAt, deletedAt, packageIds, geoIds)',
    },
    programs: { type: 'json', description: 'Programs [{id, name, packageIds, geoIds, createdAt}]' },
    subscription: {
      type: 'json',
      description:
        'Subscription (id, uri, status, package, candidateId, intervalCount, intervalUnit, startDate, nextOccurrenceDate, createdAt, canceledAt, node, workLocations)',
    },
    subscriptions: {
      type: 'json',
      description:
        'Subscriptions [{id, status, package, candidateId, intervalCount, intervalUnit, startDate, nextOccurrenceDate, canceledAt}]',
    },
    continuousCheck: {
      type: 'json',
      description: 'Continuous check (id, type, candidateId, createdAt, node, workLocations)',
    },
    continuousChecks: {
      type: 'json',
      description: 'Continuous checks [{id, type, candidateId, createdAt, node, workLocations}]',
    },
    documents: {
      type: 'json',
      description:
        'Documents (id, type, filename, contentType, filesize, downloadUri valid for 15 minutes, locale, createdAt)',
    },
    document: {
      type: 'json',
      description:
        'Document (id, type, filename, contentType, filesize, downloadUri valid for 15 minutes, locale, createdAt)',
    },
    account: {
      type: 'json',
      description:
        'Account (id, name, uriName, purpose, authorized, apiAuthorized, geosRequired, segmentationEnabled, availableScreenings, contact emails, company, accountDeauthorization)',
    },
    users: { type: 'json', description: 'Users (id, email, fullName, createdAt, roles)' },
    counties: { type: 'json', description: 'Counties (state, name, fipsCode)' },
    count: { type: 'number', description: 'Total number of matching records' },
    nextHref: { type: 'string', description: 'URL of the next page of results' },
    previousHref: { type: 'string', description: 'URL of the previous page of results' },
  },
}

export const CheckrBlockMeta = {
  tags: ['hiring', 'identity', 'webhooks'],
  url: 'https://checkr.com',
  templates: [
    {
      icon: CheckrIcon,
      title: 'Background check on offer',
      prompt:
        'Build a workflow that runs when a candidate reaches the offer stage in Greenhouse, creates the candidate in Checkr with their email, sends a Checkr invitation for the role’s package, and posts the invitation link and status to the hiring channel in Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
      alsoIntegrations: ['greenhouse', 'slack'],
      featured: true,
    },
    {
      icon: CheckrIcon,
      title: 'Checkr report completed alert',
      prompt:
        'Create a workflow triggered by a completed Checkr report that reads the report, summarizes the result and any screenings that need review, and notifies the recruiter in Slack with a clear or consider recommendation.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CheckrIcon,
      title: 'Consider report review queue',
      prompt:
        'Build a workflow that runs when a Checkr report completes with a consider result, pulls the report’s assessments and the records from each criminal screening, drafts an individualized assessment summary for the adjudicator, and logs the case to a review table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'compliance', 'review'],
    },
    {
      icon: CheckrIcon,
      title: 'Expired invitation follow-up',
      prompt:
        'Create a workflow triggered when a Checkr invitation expires that looks up the candidate, sends a friendly reminder email explaining the next steps, creates a fresh invitation for the same package, and records the follow-up in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: CheckrIcon,
      title: 'Background check status digest',
      prompt:
        'Build a scheduled daily workflow that lists pending Checkr invitations, reads each invited candidate’s reports and their estimated completion dates, and sends the hiring team a digest of who is waiting, what is delayed, and which candidates need to act.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'reporting', 'recruiting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CheckrIcon,
      title: 'Clear report to onboarding',
      prompt:
        'Create a workflow that runs when a Checkr report completes with a clear result, engages the report, tags it as onboarded, and creates the new hire’s onboarding tasks in your project tracker with their start date.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'onboarding', 'automation'],
      alsoIntegrations: ['asana'],
    },
    {
      icon: CheckrIcon,
      title: 'Annual driver rescreening',
      prompt:
        'Build a workflow that reads a table of active drivers, creates a yearly Checkr subscription for each driver who does not have one, enrolls them in continuous MVR monitoring, and writes the subscription and continuous check IDs back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'compliance', 'automation'],
    },
  ],
  skills: [
    {
      name: 'invite-candidate-to-background-check',
      description:
        'Create a Checkr candidate and send them a background check invitation for the right package. Use when a candidate is selected or receives an offer.',
      content:
        '# Invite Candidate to Background Check\n\nStart a Checkr background check for a selected candidate.\n\n## Steps\n1. Search for an existing candidate by email with List Candidates to avoid duplicates.\n2. If none exists, create the candidate with their email (and name if known).\n3. List packages to confirm the package slug for the role, unless it was given.\n4. Create an invitation for the candidate and package. For hierarchy-enabled accounts, include the node and work location.\n\n## Output\nReport the candidate ID, invitation ID, package, invitation URL, and expiry date.',
    },
    {
      name: 'summarize-background-check-report',
      description:
        'Read a completed Checkr report and summarize its result, adjudication, and the screenings that need attention. Use when a report.completed event arrives or a recruiter asks for status.',
      content:
        '# Summarize Background Check Report\n\nExplain a Checkr report in plain language for the hiring team.\n\n## Steps\n1. Get the report by ID and note its status, result, package, and adjudication.\n2. For each screening ID on the report, get the screening and note its status, result, and any records.\n3. If Assess is enabled, list the report’s assessments and the rules that flagged records.\n4. Keep PII such as SSN and date of birth out of the summary.\n\n## Output\nA short summary: overall result, screenings that are clear, screenings that need review with the reason, and the recommended next step.',
    },
    {
      name: 'check-background-check-status',
      description:
        'Report where a candidate’s Checkr background check stands, including invitation status and the report’s estimated completion. Use when a candidate or recruiter asks for an update.',
      content:
        '# Check Background Check Status\n\nGive an up-to-date status for a candidate’s background check.\n\n## Steps\n1. Find the candidate by email or custom ID with List Candidates.\n2. List the candidate’s invitations to see whether one is pending, completed, or expired.\n3. For each report on the candidate, get the report and its ETA.\n4. If a report is suspended, list its verifications to see what the candidate must provide.\n\n## Output\nThe candidate, invitation status, report status and result, estimated completion date, and any action the candidate still needs to take.',
    },
    {
      name: 'start-adverse-action',
      description:
        'Run the pre-adverse action step on a consider report by citing its adverse items. Use only after a human has reviewed the report and decided to proceed.',
      content:
        '# Start Adverse Action\n\nBegin the FCRA adverse action process on a report a reviewer decided not to move forward with.\n\n## Steps\n1. Confirm the reviewer’s decision and the report ID.\n2. Get the report and confirm its result is consider.\n3. List the report’s adverse items and select the ones the reviewer cited.\n4. Create the adverse action with those adverse item IDs, using the default post-notice timing unless told otherwise.\n\n## Output\nThe adverse action ID, status, cited items, and when the post-adverse action notice will be sent.',
    },
    {
      name: 'expired-invitation-recovery',
      description:
        'Find expired Checkr invitations and reissue them so candidates do not drop out. Use for recruiting operations clean-up.',
      content:
        '# Expired Invitation Recovery\n\nRecover candidates whose background check invitation lapsed.\n\n## Steps\n1. List invitations with status expired.\n2. For each, get the candidate and check that they do not already have a newer pending invitation or report.\n3. Create a new invitation with the same package for candidates who still need one.\n\n## Output\nA list of candidates reinvited, with new invitation IDs and URLs, and candidates skipped with the reason.',
    },
    {
      name: 'continuous-monitoring-enrollment',
      description:
        'Enroll a hired candidate in Checkr continuous criminal or MVR monitoring. Use for drivers and roles that require ongoing screening.',
      content:
        '# Continuous Monitoring Enrollment\n\nKeep a hired worker under ongoing screening.\n\n## Steps\n1. Confirm the candidate ID and whether criminal or MVR monitoring is required.\n2. List the candidate’s continuous checks to avoid duplicate enrollment.\n3. Create the continuous check, choosing the commercial MVR enrollment type for commercial drivers.\n\n## Output\nThe continuous check ID, type, and candidate, or a note that the candidate was already enrolled.',
    },
  ],
} as const satisfies BlockMeta
