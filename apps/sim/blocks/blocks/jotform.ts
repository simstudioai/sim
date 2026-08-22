import { JotformIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

/**
 * Operations that address a form by ID. Kept as one list because seventeen of the
 * thirty operations share the same `formId` field, and a hand-maintained condition
 * per field drifts the moment an operation is added.
 */
const FORM_SCOPED_OPERATIONS = [
  'get_form',
  'clone_form',
  'delete_form',
  'get_form_properties',
  'update_form_properties',
  'list_form_files',
  'list_questions',
  'get_question',
  'create_question',
  'update_question',
  'delete_question',
  'list_form_submissions',
  'create_submission',
  'create_submissions',
  'create_questions',
  'list_form_reports',
  'create_report',
  'list_webhooks',
  'create_webhook',
  'delete_webhook',
] as const

const QUESTION_SCOPED_OPERATIONS = ['get_question', 'update_question', 'delete_question'] as const

const SUBMISSION_SCOPED_OPERATIONS = [
  'get_submission',
  'update_submission',
  'delete_submission',
] as const

const LIST_OPERATIONS = ['list_forms', 'list_submissions', 'list_form_submissions'] as const

const LABEL_SCOPED_OPERATIONS = [
  'get_label',
  'update_label',
  'delete_label',
  'list_label_resources',
  'add_label_resources',
  'remove_label_resources',
] as const

const LABEL_RESOURCE_OPERATIONS = ['add_label_resources', 'remove_label_resources'] as const

export const JotformBlock: BlockConfig = {
  type: 'jotform',
  name: 'Jotform',
  description: 'Read submissions, manage forms, and wire up webhooks in Jotform',
  longDescription:
    'Integrate Jotform into your workflow to list and read form submissions with their answers resolved to question labels, build and edit forms and their questions, create shareable reports, register submission webhooks, and check account usage.',
  docsLink: 'https://docs.sim.ai/integrations/jotform',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#FFFFFF',
  icon: JotformIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Jotform',
    sentences: {
      byOperation: {
        list_forms: ['List forms'],
        get_form: [{ text: 'Get form', field: 'formId', core: true }],
        create_form: ['Create a form'],
        clone_form: [{ text: 'Clone form', field: 'formId', core: true }],
        delete_form: [{ text: 'Delete form', field: 'formId', core: true }],
        get_form_properties: [
          { text: 'Get properties of form', field: 'formId', core: true },
          { text: 'reading', field: 'propertyKey' },
        ],
        update_form_properties: [
          { text: 'Update properties of form', field: 'formId', core: true },
        ],
        list_form_files: [{ text: 'List files uploaded to form', field: 'formId', core: true }],
        list_questions: [{ text: 'List questions on form', field: 'formId', core: true }],
        get_question: [
          { text: 'Get question', field: 'questionId', core: true },
          { text: 'on form', field: 'formId' },
        ],
        create_question: [
          { text: 'Add question', field: 'questionText', core: true },
          { text: 'to form', field: 'formId' },
        ],
        update_question: [
          { text: 'Update question', field: 'questionId', core: true },
          { text: 'on form', field: 'formId' },
        ],
        delete_question: [
          { text: 'Delete question', field: 'questionId', core: true },
          { text: 'from form', field: 'formId' },
        ],
        list_form_submissions: [{ text: 'List submissions to form', field: 'formId', core: true }],
        list_submissions: ['List submissions across every form'],
        get_submission: [{ text: 'Get submission', field: 'submissionId', core: true }],
        create_submission: [{ text: 'Submit an entry to form', field: 'formId', core: true }],
        update_submission: [{ text: 'Update submission', field: 'submissionId', core: true }],
        delete_submission: [{ text: 'Delete submission', field: 'submissionId', core: true }],
        list_reports: ['List reports'],
        list_form_reports: [{ text: 'List reports for form', field: 'formId', core: true }],
        create_report: [
          { text: 'Create report', field: 'reportTitle', core: true },
          { text: 'for form', field: 'formId' },
        ],
        get_report: [{ text: 'Get report', field: 'reportId', core: true }],
        delete_report: [{ text: 'Delete report', field: 'reportId', core: true }],
        list_webhooks: [{ text: 'List webhooks on form', field: 'formId', core: true }],
        create_webhook: [
          { text: 'Add webhook', field: 'webhookUrl', core: true },
          { text: 'to form', field: 'formId' },
        ],
        delete_webhook: [
          { text: 'Delete webhook', field: 'webhookId', core: true },
          { text: 'from form', field: 'formId' },
        ],
        create_submissions: [{ text: 'Submit entries to form', field: 'formId', core: true }],
        create_questions: [{ text: 'Add questions to form', field: 'formId', core: true }],
        list_labels: ['List labels'],
        get_label: [{ text: 'Get label', field: 'labelId', core: true }],
        create_label: [{ text: 'Create label', field: 'labelName', core: true }],
        update_label: [{ text: 'Update label', field: 'labelId', core: true }],
        delete_label: [{ text: 'Delete label', field: 'labelId', core: true }],
        list_label_resources: [{ text: 'List assets in label', field: 'labelId', core: true }],
        add_label_resources: [{ text: 'Add assets to label', field: 'labelId', core: true }],
        remove_label_resources: [
          { text: 'Remove assets from label', field: 'labelId', core: true },
        ],
        list_subusers: ['List sub-users'],
        get_settings: ['Get account settings'],
        update_settings: ['Update account settings'],
        get_user: ['Get account details'],
        get_usage: ['Get monthly usage'],
        get_history: ['Read account history'],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Forms', id: 'list_forms' },
        { label: 'Get Form', id: 'get_form' },
        { label: 'Create Form', id: 'create_form' },
        { label: 'Clone Form', id: 'clone_form' },
        { label: 'Delete Form', id: 'delete_form' },
        { label: 'Get Form Properties', id: 'get_form_properties' },
        { label: 'Update Form Properties', id: 'update_form_properties' },
        { label: 'List Form Files', id: 'list_form_files' },
        { label: 'List Questions', id: 'list_questions' },
        { label: 'Get Question', id: 'get_question' },
        { label: 'Create Question', id: 'create_question' },
        { label: 'Create Questions', id: 'create_questions' },
        { label: 'Update Question', id: 'update_question' },
        { label: 'Delete Question', id: 'delete_question' },
        { label: 'List Form Submissions', id: 'list_form_submissions' },
        { label: 'List Submissions', id: 'list_submissions' },
        { label: 'Get Submission', id: 'get_submission' },
        { label: 'Create Submission', id: 'create_submission' },
        { label: 'Create Submissions', id: 'create_submissions' },
        { label: 'Update Submission', id: 'update_submission' },
        { label: 'Delete Submission', id: 'delete_submission' },
        { label: 'List Reports', id: 'list_reports' },
        { label: 'List Form Reports', id: 'list_form_reports' },
        { label: 'Create Report', id: 'create_report' },
        { label: 'Get Report', id: 'get_report' },
        { label: 'Delete Report', id: 'delete_report' },
        { label: 'List Webhooks', id: 'list_webhooks' },
        { label: 'Create Webhook', id: 'create_webhook' },
        { label: 'Delete Webhook', id: 'delete_webhook' },
        { label: 'List Labels', id: 'list_labels' },
        { label: 'Get Label', id: 'get_label' },
        { label: 'Create Label', id: 'create_label' },
        { label: 'Update Label', id: 'update_label' },
        { label: 'Delete Label', id: 'delete_label' },
        { label: 'List Label Resources', id: 'list_label_resources' },
        { label: 'Add Label Resources', id: 'add_label_resources' },
        { label: 'Remove Label Resources', id: 'remove_label_resources' },
        { label: 'List Sub-Users', id: 'list_subusers' },
        { label: 'Get Settings', id: 'get_settings' },
        { label: 'Update Settings', id: 'update_settings' },
        { label: 'Get Account', id: 'get_user' },
        { label: 'Get Usage', id: 'get_usage' },
        { label: 'Get History', id: 'get_history' },
      ],
      value: () => 'list_form_submissions',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Jotform API key',
      password: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'US (api.jotform.com)', id: 'us' },
        { label: 'EU (eu-api.jotform.com)', id: 'eu' },
        { label: 'HIPAA (hipaa-api.jotform.com)', id: 'hipaa' },
      ],
      value: () => 'us',
      mode: 'advanced',
    },

    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: 'e.g., 231504059977966',
      required: { field: 'operation', value: [...FORM_SCOPED_OPERATIONS] },
      condition: { field: 'operation', value: [...FORM_SCOPED_OPERATIONS] },
    },
    {
      id: 'questionId',
      title: 'Question ID',
      type: 'short-input',
      placeholder: 'From the List Questions operation',
      required: { field: 'operation', value: [...QUESTION_SCOPED_OPERATIONS] },
      condition: { field: 'operation', value: [...QUESTION_SCOPED_OPERATIONS] },
    },
    {
      id: 'submissionId',
      title: 'Submission ID',
      type: 'short-input',
      placeholder: 'e.g., 5237955080346633702',
      required: { field: 'operation', value: [...SUBMISSION_SCOPED_OPERATIONS] },
      condition: { field: 'operation', value: [...SUBMISSION_SCOPED_OPERATIONS] },
    },
    {
      id: 'reportId',
      title: 'Report ID',
      type: 'short-input',
      placeholder: 'From the List Reports operation',
      required: { field: 'operation', value: ['get_report', 'delete_report'] },
      condition: { field: 'operation', value: ['get_report', 'delete_report'] },
    },

    {
      id: 'propertyKey',
      title: 'Property Key',
      type: 'short-input',
      placeholder: 'Leave empty for every property, e.g., formWidth',
      condition: { field: 'operation', value: 'get_form_properties' },
    },
    {
      id: 'formPropertiesJson',
      title: 'Properties',
      type: 'long-input',
      placeholder: '{"thankurl": "https://example.com/thanks", "activeRedirect": "thankurl"}',
      required: { field: 'operation', value: 'update_form_properties' },
      condition: { field: 'operation', value: 'update_form_properties' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Jotform form properties to update, such as thankurl, activeRedirect, formWidth, labelWidth, limitSubmission, or messageOfLimitedForm. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    {
      id: 'newFormQuestions',
      title: 'Questions',
      type: 'long-input',
      placeholder: '[{"type": "control_email", "text": "Email", "order": "1", "name": "email"}]',
      required: { field: 'operation', value: 'create_form' },
      condition: { field: 'operation', value: 'create_form' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Jotform question objects. Each object needs type (e.g. control_textbox, control_textarea, control_dropdown, control_radio, control_checkbox, control_fileupload, control_fullname, control_email, control_datetime), text, order, and name. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'newFormProperties',
      title: 'Form Properties',
      type: 'long-input',
      placeholder: '{"title": "Contact Us", "height": "600"}',
      condition: { field: 'operation', value: 'create_form' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Jotform form properties, such as title and height. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'newFormEmails',
      title: 'Notification Emails',
      type: 'long-input',
      placeholder:
        '[{"type": "notification", "to": "team@example.com", "subject": "New submission"}]',
      condition: { field: 'operation', value: 'create_form' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Jotform email objects. Each object takes type (notification or autorespond), from, to, subject, html, and body. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    {
      id: 'questionType',
      title: 'Question Type',
      type: 'short-input',
      placeholder: 'e.g., control_textbox, control_email, control_dropdown',
      required: { field: 'operation', value: 'create_question' },
      condition: { field: 'operation', value: 'create_question' },
    },
    {
      id: 'questionText',
      title: 'Question Label',
      type: 'short-input',
      placeholder: 'Label shown on the form',
      condition: { field: 'operation', value: ['create_question', 'update_question'] },
    },
    {
      id: 'questionOrder',
      title: 'Question Order',
      type: 'short-input',
      placeholder: 'Position on the form, e.g., 3',
      condition: { field: 'operation', value: ['create_question', 'update_question'] },
      mode: 'advanced',
    },
    {
      id: 'questionName',
      title: 'Question Name',
      type: 'short-input',
      placeholder: 'Slug for the question label',
      condition: { field: 'operation', value: ['create_question', 'update_question'] },
      mode: 'advanced',
    },
    {
      id: 'questionProperties',
      title: 'Additional Properties',
      type: 'long-input',
      placeholder: '{"required": "Yes", "validation": "Email"}',
      condition: { field: 'operation', value: ['create_question', 'update_question'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of extra Jotform question properties, such as required, validation, hint, size, or options. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    {
      id: 'answers',
      title: 'Answers',
      type: 'long-input',
      placeholder: '{"3": {"first": "Bart", "last": "Simpson"}, "4": "Hello"}',
      required: { field: 'operation', value: ['create_submission', 'update_submission'] },
      condition: { field: 'operation', value: ['create_submission', 'update_submission'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON object of Jotform submission answers keyed by question ID. Multi-field questions take an object of their sub-fields, e.g. {"3": {"first": "Bart", "last": "Simpson"}, "4": "Hello"}. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    {
      id: 'reportTitle',
      title: 'Report Title',
      type: 'short-input',
      placeholder: 'e.g., Weekly responses',
      required: { field: 'operation', value: 'create_report' },
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'reportType',
      title: 'Report Type',
      type: 'dropdown',
      options: [
        { label: 'Excel', id: 'excel' },
        { label: 'CSV', id: 'csv' },
        { label: 'Grid', id: 'grid' },
        { label: 'Table', id: 'table' },
        { label: 'Calendar', id: 'calendar' },
        { label: 'RSS', id: 'rss' },
        { label: 'Visual', id: 'visual' },
      ],
      value: () => 'csv',
      required: { field: 'operation', value: 'create_report' },
      condition: { field: 'operation', value: 'create_report' },
    },
    {
      id: 'reportFields',
      title: 'Report Fields',
      type: 'short-input',
      placeholder: 'e.g., ip,dt,3,4',
      condition: { field: 'operation', value: 'create_report' },
      mode: 'advanced',
    },

    {
      id: 'webhookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/jotform-submissions',
      required: { field: 'operation', value: 'create_webhook' },
      condition: { field: 'operation', value: 'create_webhook' },
    },
    {
      id: 'webhookId',
      title: 'Webhook ID',
      type: 'short-input',
      placeholder: 'From the List Webhooks operation',
      required: { field: 'operation', value: 'delete_webhook' },
      condition: { field: 'operation', value: 'delete_webhook' },
    },

    {
      id: 'bulkSubmissions',
      title: 'Submissions',
      type: 'long-input',
      placeholder: '[{"1": {"text": "Answer 1"}, "2": {"text": "Answer 2"}}]',
      required: { field: 'operation', value: 'create_submissions' },
      condition: { field: 'operation', value: 'create_submissions' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Jotform submissions. Each entry maps a question ID to an object holding its answer, e.g. [{"1": {"text": "Answer 1"}, "2": {"text": "Answer 2"}}]. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'bulkQuestions',
      title: 'Questions',
      type: 'long-input',
      placeholder: '[{"type": "control_head", "text": "Section", "order": "1", "name": "section"}]',
      required: { field: 'operation', value: 'create_questions' },
      condition: { field: 'operation', value: 'create_questions' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Jotform question objects. Each object needs type (e.g. control_textbox, control_dropdown, control_email), text, order, and name. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    {
      id: 'labelId',
      title: 'Label ID',
      type: 'short-input',
      placeholder: 'From the List Labels operation',
      required: { field: 'operation', value: [...LABEL_SCOPED_OPERATIONS] },
      condition: { field: 'operation', value: [...LABEL_SCOPED_OPERATIONS] },
    },
    {
      id: 'labelName',
      title: 'Label Name',
      type: 'short-input',
      placeholder: 'e.g., IT Operations',
      required: { field: 'operation', value: 'create_label' },
      condition: { field: 'operation', value: ['create_label', 'update_label'] },
    },
    {
      id: 'color',
      title: 'Color',
      type: 'short-input',
      placeholder: 'Hex code, e.g., #FFDC7B',
      condition: { field: 'operation', value: ['create_label', 'update_label'] },
    },
    {
      id: 'parent',
      title: 'Parent Label',
      type: 'short-input',
      placeholder: 'ID of the label to nest this one under',
      condition: { field: 'operation', value: 'create_label' },
      mode: 'advanced',
    },
    {
      id: 'resources',
      title: 'Assets',
      type: 'long-input',
      placeholder: '[{"id": "251464995493876", "type": "form"}]',
      required: { field: 'operation', value: [...LABEL_RESOURCE_OPERATIONS] },
      condition: { field: 'operation', value: [...LABEL_RESOURCE_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Jotform label resources. Each entry needs an id and a type of form, workflow, sheet, or portal, e.g. [{"id": "251464995493876", "type": "form"}]. Return ONLY the JSON array - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },
    {
      id: 'addResources',
      title: 'Include Resources',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'list_labels' },
      mode: 'advanced',
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'e.g., active',
      condition: { field: 'operation', value: 'list_label_resources' },
      mode: 'advanced',
    },

    {
      id: 'settingsKey',
      title: 'Setting Key',
      type: 'short-input',
      placeholder: 'Leave empty for every setting, e.g., time_zone',
      condition: { field: 'operation', value: 'get_settings' },
    },
    {
      id: 'settingsName',
      title: 'Name',
      type: 'short-input',
      placeholder: 'New display name on the account',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'New account email address',
      condition: { field: 'operation', value: 'update_settings' },
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'timeZone',
      title: 'Time Zone',
      type: 'short-input',
      placeholder: 'IANA name, e.g., America/New_York',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Company recorded on the account',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },
    {
      id: 'industry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Industry recorded on the account',
      condition: { field: 'operation', value: 'update_settings' },
      mode: 'advanced',
    },

    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Default 20, maximum 1000',
      condition: { field: 'operation', value: [...LIST_OPERATIONS, 'list_label_resources'] },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Index of the first result. Default 0',
      condition: { field: 'operation', value: [...LIST_OPERATIONS, 'list_label_resources'] },
      mode: 'advanced',
    },
    {
      id: 'orderby',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'e.g., created_at',
      condition: { field: 'operation', value: [...LIST_OPERATIONS, 'list_label_resources'] },
      mode: 'advanced',
    },
    {
      id: 'direction',
      title: 'Direction',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'DESC' },
        { label: 'Ascending', id: 'ASC' },
      ],
      value: () => 'DESC',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      placeholder: '{"created_at:gt": "2024-01-01 00:00:00"}',
      condition: { field: 'operation', value: [...LIST_OPERATIONS] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Jotform filter JSON object. Supported forms include {"created_at:gt": "YYYY-MM-DD HH:MM:SS"}, {"new": "1"}, {"status": "ENABLED"}, {"formIDs": ["id"]}, and {"fullText": "search term"}. Return ONLY the JSON object - no explanations, no extra text.',
        generationType: 'json-object',
      },
    },

    {
      id: 'historyAction',
      title: 'Activity',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Account Created', id: 'userCreation' },
        { label: 'Account Login', id: 'userLogin' },
        { label: 'Form Created', id: 'formCreation' },
        { label: 'Form Updated', id: 'formUpdate' },
        { label: 'Form Deleted', id: 'formDelete' },
        { label: 'Form Purged', id: 'formPurge' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'get_history' },
    },
    {
      id: 'historyStartDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'MM/DD/YYYY',
      condition: { field: 'operation', value: 'get_history' },
      mode: 'advanced',
    },
    {
      id: 'historyEndDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'MM/DD/YYYY',
      condition: { field: 'operation', value: 'get_history' },
      mode: 'advanced',
    },
    {
      id: 'historySortBy',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'DESC' },
        { label: 'Ascending', id: 'ASC' },
      ],
      value: () => 'DESC',
      condition: { field: 'operation', value: 'get_history' },
      mode: 'advanced',
    },

    ...getTrigger('jotform_webhook').subBlocks,
  ],

  tools: {
    access: [
      'jotform_list_forms',
      'jotform_get_form',
      'jotform_create_form',
      'jotform_clone_form',
      'jotform_delete_form',
      'jotform_get_form_properties',
      'jotform_update_form_properties',
      'jotform_list_form_files',
      'jotform_list_questions',
      'jotform_get_question',
      'jotform_create_question',
      'jotform_update_question',
      'jotform_delete_question',
      'jotform_list_form_submissions',
      'jotform_list_submissions',
      'jotform_get_submission',
      'jotform_create_submission',
      'jotform_update_submission',
      'jotform_delete_submission',
      'jotform_list_reports',
      'jotform_list_form_reports',
      'jotform_create_report',
      'jotform_get_report',
      'jotform_delete_report',
      'jotform_list_webhooks',
      'jotform_create_webhook',
      'jotform_delete_webhook',
      'jotform_get_user',
      'jotform_get_usage',
      'jotform_get_history',
      'jotform_create_submissions',
      'jotform_create_questions',
      'jotform_list_labels',
      'jotform_get_label',
      'jotform_create_label',
      'jotform_update_label',
      'jotform_delete_label',
      'jotform_list_label_resources',
      'jotform_add_label_resources',
      'jotform_remove_label_resources',
      'jotform_list_subusers',
      'jotform_get_settings',
      'jotform_update_settings',
    ],
    config: {
      tool: (params) => `jotform_${params.operation}`,
      /**
       * Only the subblocks whose id differs from the tool param are remapped here.
       * Everything else — formId, submissionId, answers, the pagination fields — is
       * named after its param and reaches the tool unchanged.
       */
      params: (params) => {
        const result: Record<string, unknown> = {}

        switch (params.operation) {
          case 'create_form':
            if (params.newFormQuestions) result.questions = params.newFormQuestions
            if (params.newFormProperties) result.properties = params.newFormProperties
            if (params.newFormEmails) result.emails = params.newFormEmails
            break

          case 'update_form_properties':
            if (params.formPropertiesJson) result.properties = params.formPropertiesJson
            break

          case 'create_question':
          case 'update_question':
            if (params.questionText) result.text = params.questionText
            if (params.questionOrder) result.order = params.questionOrder
            if (params.questionName) result.name = params.questionName
            break

          case 'create_report':
            if (params.reportTitle) result.title = params.reportTitle
            if (params.reportType) result.listType = params.reportType
            if (params.reportFields) result.fields = params.reportFields
            break

          case 'create_submissions':
            if (params.bulkSubmissions) result.submissions = params.bulkSubmissions
            break

          case 'create_questions':
            if (params.bulkQuestions) result.questions = params.bulkQuestions
            break

          case 'get_history':
            if (params.historyAction) result.action = params.historyAction
            if (params.historySortBy) result.sortBy = params.historySortBy
            if (params.historyStartDate) result.startDate = params.historyStartDate
            if (params.historyEndDate) result.endDate = params.historyEndDate
            break
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Jotform API key' },
    region: { type: 'string', description: 'Jotform data residency region: us, eu, or hipaa' },
    formId: { type: 'string', description: 'ID of the form to act on' },
    questionId: { type: 'string', description: 'ID of the question to act on' },
    submissionId: { type: 'string', description: 'ID of the submission to act on' },
    reportId: { type: 'string', description: 'ID of the report to act on' },
    propertyKey: { type: 'string', description: 'Single form property to read' },
    formPropertiesJson: { type: 'string', description: 'Form properties to update, as JSON' },
    newFormQuestions: { type: 'string', description: 'Questions for a new form, as a JSON array' },
    newFormProperties: { type: 'string', description: 'Properties for a new form, as JSON' },
    newFormEmails: {
      type: 'string',
      description: 'Notification emails for a new form, as a JSON array',
    },
    questionType: { type: 'string', description: 'Field type of a new question' },
    questionText: { type: 'string', description: 'Label of the question' },
    questionOrder: { type: 'string', description: 'Position of the question on the form' },
    questionName: { type: 'string', description: 'Slug of the question label' },
    questionProperties: {
      type: 'string',
      description: 'Extra type-specific question properties, as JSON',
    },
    answers: { type: 'string', description: 'Submission answers keyed by question ID, as JSON' },
    reportTitle: { type: 'string', description: 'Title of the report to create' },
    reportType: { type: 'string', description: 'Report type to create' },
    reportFields: {
      type: 'string',
      description: 'Comma-separated fields to include in the report',
    },
    webhookUrl: { type: 'string', description: 'URL Jotform posts submissions to' },
    webhookId: { type: 'string', description: 'ID of the webhook to delete' },
    limit: { type: 'string', description: 'Number of results to return' },
    offset: { type: 'string', description: 'Index of the first result to return' },
    orderby: { type: 'string', description: 'Field to order results by' },
    direction: { type: 'string', description: 'Sort direction: ASC or DESC' },
    filter: { type: 'string', description: 'Result filter, as JSON' },
    historyAction: { type: 'string', description: 'Activity type to filter history by' },
    historyStartDate: { type: 'string', description: 'History range start, MM/DD/YYYY' },
    historyEndDate: { type: 'string', description: 'History range end, MM/DD/YYYY' },
    historySortBy: { type: 'string', description: 'History sort order: ASC or DESC' },
    bulkSubmissions: {
      type: 'string',
      description: 'Submissions to create in bulk, as a JSON array',
    },
    bulkQuestions: { type: 'string', description: 'Questions to add in bulk, as a JSON array' },
    labelId: { type: 'string', description: 'ID of the label to act on' },
    labelName: { type: 'string', description: 'Name of the label' },
    color: { type: 'string', description: 'Label color, as a hex code' },
    parent: { type: 'string', description: 'ID of the parent label' },
    resources: {
      type: 'string',
      description: 'Assets to add to or remove from a label, as a JSON array',
    },
    addResources: {
      type: 'string',
      description: 'Whether to include each label resources in the label list',
    },
    status: { type: 'string', description: 'Asset status to filter label resources by' },
    settingsKey: { type: 'string', description: 'Single account setting to read' },
    settingsName: { type: 'string', description: 'New display name on the account' },
    email: { type: 'string', description: 'New account email address' },
    website: { type: 'string', description: 'New website recorded on the account' },
    timeZone: { type: 'string', description: 'New account time zone, in IANA format' },
    company: { type: 'string', description: 'New company recorded on the account' },
    industry: { type: 'string', description: 'New industry recorded on the account' },
  },

  outputs: {
    forms: {
      type: 'json',
      description: 'Forms on the account (list_forms)',
    },
    form: {
      type: 'json',
      description:
        'A single form with its title, status, URL, and submission counts (get_form, create_form, clone_form, delete_form)',
    },
    questions: {
      type: 'json',
      description:
        'Questions on the form, each with qid, text, type, and its type-specific properties (list_questions)',
    },
    question: {
      type: 'json',
      description:
        'A single question, or the properties that were edited (get_question, create_question, update_question)',
    },
    submissions: {
      type: 'json',
      description:
        'Submissions, each with answers keyed by question ID and values keyed by question label, repeated labels suffixed with their question ID (list_form_submissions, list_submissions)',
    },
    submission: {
      type: 'json',
      description:
        'A single submission with its answers keyed by question ID and values keyed by question label (get_submission)',
    },
    submissionId: {
      type: 'string',
      description: 'ID of the created or edited submission (create_submission, update_submission)',
    },
    url: {
      type: 'string',
      description: 'API URL of the created or edited submission',
    },
    pagination: {
      type: 'json',
      description: 'Offset, limit, and count reported for a list result',
    },
    properties: {
      type: 'json',
      description:
        'Form properties, or the property keys that were edited (get_form_properties, update_form_properties)',
    },
    files: {
      type: 'json',
      description: 'Files uploaded through the form, each with a download URL (list_form_files)',
    },
    reports: {
      type: 'json',
      description: 'Reports with their shareable URLs (list_reports, list_form_reports)',
    },
    report: {
      type: 'json',
      description: 'A single report with its shareable URL (create_report, get_report)',
    },
    webhooks: {
      type: 'json',
      description:
        'Webhooks on the form, each with the ID needed to delete it (list_webhooks, create_webhook, delete_webhook)',
    },
    user: {
      type: 'json',
      description:
        'Account details or settings behind the API key (get_user, get_settings, update_settings)',
    },
    labels: {
      type: 'json',
      description: 'Labels on the account, nested through sublabels (list_labels)',
    },
    label: {
      type: 'json',
      description:
        'A single label, or the label fields that were edited (get_label, create_label, update_label)',
    },
    resources: {
      type: 'json',
      description:
        'Assets assigned to a label (list_label_resources, add_label_resources, remove_label_resources)',
    },
    subusers: {
      type: 'json',
      description: 'Sub-users on the account with their access grants (list_subusers)',
    },
    count: {
      type: 'number',
      description: 'Number of submissions created (create_submissions)',
    },
    usage: {
      type: 'json',
      description: 'Monthly submission, payment, view, and upload counters (get_usage)',
    },
    history: {
      type: 'json',
      description: 'Account activity entries (get_history)',
    },
    deleted: {
      type: 'boolean',
      description: 'True when a delete operation succeeded',
    },
    message: {
      type: 'string',
      description: 'Confirmation text returned by a delete operation',
    },
  },

  triggers: {
    enabled: true,
    available: ['jotform_webhook'],
  },
}

export const JotformBlockMeta = {
  tags: ['forms', 'automation', 'webhooks'],
  url: 'https://www.jotform.com',
  templates: [
    {
      icon: JotformIcon,
      title: 'Jotform submissions to a table',
      prompt:
        'Build a scheduled workflow that lists new Jotform submissions for a form every hour, filtering on submissions created since the last run, and appends each one to a table with the answers mapped to their question labels.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'operations',
      tags: ['sync', 'automation'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform lead routing to Slack',
      prompt:
        'Create a workflow that reads unread Jotform submissions for a contact form, has an agent classify each one as a sales lead, support request, or spam, and posts the qualified leads to the sales channel in Slack.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['lead-routing', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform applications into a hiring pipeline',
      prompt:
        'Build a workflow that pulls Jotform job application submissions, downloads the uploaded resume files from the form, has an agent summarize each candidate against the role requirements, and creates a Notion page per applicant.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hiring', 'automation'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform submission webhook fan-out',
      prompt:
        'Create a workflow that registers a Jotform webhook on a form pointing at an API trigger, then processes each incoming submission by writing it to a table and emailing the submitter a confirmation.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['webhooks', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform support intake into tickets',
      prompt:
        'Build a workflow that reads new Jotform support form submissions, has an agent assign a priority and category from the answers, and opens a matching Linear issue with the submission details in the description.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['ticketing', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform weekly response digest',
      prompt:
        'Create a scheduled workflow that runs every Monday, lists the past week of Jotform submissions across every form, has an agent summarize the themes and outliers, and emails the digest to the operations team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform CRM sync for event signups',
      prompt:
        'Build a workflow that reads Jotform event registration submissions, upserts each attendee as a HubSpot contact with the answers mapped onto contact properties, and marks the submission as processed in a table.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sync', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: JotformIcon,
      title: 'Jotform report generation on demand',
      prompt:
        'Create a workflow that takes a form ID and a date range, creates a CSV Jotform report scoped to the selected question fields, and posts the shareable report link to the requesting Slack thread.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'organize-forms-with-labels',
      description:
        'Group Jotform forms and other assets under labels, creating the label first when it does not exist.',
      content:
        '# Organize Forms With Labels\n\nLabels are how Jotform groups assets. They replace the deprecated folder endpoints.\n\n## Steps\n1. List the labels to see what already exists. The response is a tree: a root entry whose sublabels hold the user-visible labels.\n2. Create the label if it is missing, optionally nesting it under a parent and giving it a hex color.\n3. Add the assets, each identified by an id and a type of form, workflow, sheet, or portal.\n4. List the label resources to confirm what it now holds.\n\n## Output\nThe label id, its name and color, and the assets assigned to it. Note anything that was already labeled.',
    },
    {
      name: 'bulk-import-responses',
      description:
        'Load many rows into a Jotform form as submissions in one call, after mapping columns to question IDs.',
      content:
        '# Bulk Import Responses\n\nMove a batch of existing records into a Jotform form.\n\n## Steps\n1. List the questions on the target form to map each source column to a question ID.\n2. Build one entry per record, keyed by question ID, e.g. `[{"1": {"text": "Answer 1"}}]`.\n3. Create the submissions in bulk. Send them in batches rather than one enormous request, and remember each call counts against the daily API limit.\n4. Keep the returned submission IDs so the import can be reconciled.\n\n## Output\nThe count created and their submission IDs, plus any source rows that had no matching question.',
    },
    {
      name: 'read-form-responses',
      description:
        'Pull Jotform submissions for a form and report the answers by question label instead of question ID.',
      content:
        '# Read Form Responses\n\nTurn raw Jotform submissions into readable answers.\n\n## Steps\n1. Identify the form. List forms if only the title is known.\n2. List the submissions for that form. Set a limit, and use a filter such as `{"created_at:gt": "YYYY-MM-DD HH:MM:SS"}` or `{"new": "1"}` to narrow the window.\n3. Read each submission from `values`, which is keyed by question label. Fall back to `answers` when a question has sub-fields worth reading individually.\n\n## Output\nThe matched submissions with their labeled answers, the time range covered, and the total count.',
    },
    {
      name: 'submit-to-form',
      description:
        'Submit an entry to a Jotform form, resolving question IDs from the form definition first.',
      content:
        '# Submit To Form\n\nCreate a Jotform submission through the API.\n\n## Steps\n1. List the questions on the target form to get each question ID and field type.\n2. Build the answers object keyed by question ID. Multi-field types such as `control_fullname` and `control_address` take an object of their sub-fields.\n3. Create the submission and keep the returned submission ID.\n\n## Output\nThe new submission ID, plus which questions were filled and which were left empty.',
    },
    {
      name: 'set-up-submission-webhook',
      description:
        'Register a Jotform webhook so new submissions are pushed to a URL, and confirm what is already registered.',
      content:
        '# Set Up Submission Webhook\n\nPush Jotform submissions somewhere the moment they arrive.\n\n## Steps\n1. List the webhooks already on the form so an existing one is not duplicated.\n2. Add the webhook URL. Jotform returns the full list, including the ID of each entry.\n3. Note the ID of the new webhook so it can be removed later.\n\n## Output\nThe registered URL, its webhook ID, and every other webhook still on the form.',
    },
    {
      name: 'build-a-form',
      description:
        'Create a Jotform form from a list of fields, then verify the questions landed as intended.',
      content:
        '# Build A Form\n\nCreate a form and confirm its structure.\n\n## Steps\n1. Translate each requested field into a question object with a type, label, order, and name. Common types are control_textbox, control_textarea, control_dropdown, control_radio, control_checkbox, control_fileupload, control_fullname, control_email, and control_datetime.\n2. Create the form, supplying a title in the form properties.\n3. List the questions on the new form to confirm the order and types.\n4. Add any missing question individually rather than recreating the form.\n\n## Output\nThe form ID, its public URL, and the final question list with IDs.',
    },
    {
      name: 'share-a-report',
      description:
        'Create a Jotform report over the chosen submission fields and return its shareable link.',
      content:
        '# Share A Report\n\nProduce a shareable view of a form responses.\n\n## Steps\n1. List the questions on the form to pick which question IDs belong in the report.\n2. Build the fields string from `ip`, `dt` for the submission date, and the chosen question IDs, e.g. `ip,dt,3,4`.\n3. Create the report with a title and a type: excel, csv, grid, table, calendar, rss, or visual.\n4. Return the report URL.\n\n## Output\nThe report URL, its type, and which fields it exposes. Note whether it is password protected.',
    },
  ],
} as const satisfies BlockMeta
