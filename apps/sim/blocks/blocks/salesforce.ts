import { getScopesForService } from '@/lib/oauth/utils'
import { SalesforceBlockDisplay } from '@/blocks/blocks/salesforce.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SalesforceResponse } from '@/tools/salesforce/types'
import { getTrigger } from '@/triggers'

export const SalesforceBlock: BlockConfig<SalesforceResponse> = {
  ...SalesforceBlockDisplay,
  authMode: AuthMode.OAuth,
  triggers: {
    enabled: true,
    available: [
      'salesforce_record_created',
      'salesforce_record_updated',
      'salesforce_record_deleted',
      'salesforce_opportunity_stage_changed',
      'salesforce_case_status_changed',
      'salesforce_webhook',
    ],
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Accounts', id: 'get_accounts' },
        { label: 'Create Account', id: 'create_account' },
        { label: 'Update Account', id: 'update_account' },
        { label: 'Delete Account', id: 'delete_account' },
        { label: 'Get Contacts', id: 'get_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'Get Leads', id: 'get_leads' },
        { label: 'Create Lead', id: 'create_lead' },
        { label: 'Update Lead', id: 'update_lead' },
        { label: 'Delete Lead', id: 'delete_lead' },
        { label: 'Get Opportunities', id: 'get_opportunities' },
        { label: 'Create Opportunity', id: 'create_opportunity' },
        { label: 'Update Opportunity', id: 'update_opportunity' },
        { label: 'Delete Opportunity', id: 'delete_opportunity' },
        { label: 'Get Cases', id: 'get_cases' },
        { label: 'Create Case', id: 'create_case' },
        { label: 'Update Case', id: 'update_case' },
        { label: 'Delete Case', id: 'delete_case' },
        { label: 'Get Tasks', id: 'get_tasks' },
        { label: 'Create Task', id: 'create_task' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Delete Task', id: 'delete_task' },
        { label: 'List Reports', id: 'list_reports' },
        { label: 'Get Report', id: 'get_report' },
        { label: 'Run Report', id: 'run_report' },
        { label: 'List Report Types', id: 'list_report_types' },
        { label: 'List Dashboards', id: 'list_dashboards' },
        { label: 'Get Dashboard', id: 'get_dashboard' },
        { label: 'Refresh Dashboard', id: 'refresh_dashboard' },
        { label: 'Run SOQL Query', id: 'query' },
        { label: 'Get More Query Results', id: 'query_more' },
        { label: 'Describe Object', id: 'describe_object' },
        { label: 'List Objects', id: 'list_objects' },
        { label: 'Create Custom Field', id: 'create_custom_field' },
        { label: 'Update Custom Field', id: 'update_custom_field' },
        { label: 'Delete Custom Field', id: 'delete_custom_field' },
        { label: 'Create Custom Object', id: 'create_custom_object' },
        { label: 'Run Tooling Query', id: 'tooling_query' },
      ],
      value: () => 'get_accounts',
    },
    {
      id: 'credential',
      title: 'Salesforce Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'salesforce',
      requiredScopes: getScopesForService('salesforce'),
      placeholder: 'Select Salesforce account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Salesforce Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    // Common fields for GET operations
    {
      id: 'fields',
      title: 'Fields to Return',
      type: 'short-input',
      placeholder: 'Comma-separated fields',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_accounts',
          'get_contacts',
          'get_leads',
          'get_opportunities',
          'get_cases',
          'get_tasks',
        ],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (default: 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_accounts',
          'get_contacts',
          'get_leads',
          'get_opportunities',
          'get_cases',
          'get_tasks',
        ],
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Field and direction (e.g., "Name ASC")',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'get_accounts',
          'get_contacts',
          'get_leads',
          'get_opportunities',
          'get_cases',
          'get_tasks',
        ],
      },
    },
    // Account fields
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Salesforce Account ID',
      condition: {
        field: 'operation',
        value: [
          'update_account',
          'delete_account',
          'create_contact',
          'update_contact',
          'create_case',
          'update_case',
          'create_opportunity',
          'update_opportunity',
        ],
      },
      required: { field: 'operation', value: ['update_account', 'delete_account'] },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Name',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account', 'create_opportunity', 'update_opportunity'],
      },
      required: { field: 'operation', value: ['create_account', 'create_opportunity'] },
    },
    {
      id: 'type',
      title: 'Type',
      type: 'short-input',
      placeholder: 'Type',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'industry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Industry',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone',
      condition: {
        field: 'operation',
        value: [
          'create_account',
          'update_account',
          'create_contact',
          'update_contact',
          'create_lead',
          'update_lead',
        ],
      },
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'Website',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'billingStreet',
      title: 'Billing Street',
      type: 'short-input',
      placeholder: 'Billing street address',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'billingCity',
      title: 'Billing City',
      type: 'short-input',
      placeholder: 'Billing city',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'billingState',
      title: 'Billing State',
      type: 'short-input',
      placeholder: 'Billing state/province',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'billingPostalCode',
      title: 'Billing Postal Code',
      type: 'short-input',
      placeholder: 'Billing postal code',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'billingCountry',
      title: 'Billing Country',
      type: 'short-input',
      placeholder: 'Billing country',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'annualRevenue',
      title: 'Annual Revenue',
      type: 'short-input',
      placeholder: 'Annual revenue (number)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    {
      id: 'numberOfEmployees',
      title: 'Number of Employees',
      type: 'short-input',
      placeholder: 'Employee count (integer)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_account', 'update_account'] },
    },
    // Contact fields
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Contact ID',
      condition: {
        field: 'operation',
        value: ['get_contacts', 'update_contact', 'delete_contact', 'create_case', 'update_case'],
      },
      required: { field: 'operation', value: ['update_contact', 'delete_contact'] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_lead', 'update_lead'],
      },
      required: { field: 'operation', value: ['create_contact', 'create_lead'] },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_lead', 'update_lead'],
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_lead', 'update_lead'],
      },
    },
    {
      id: 'title',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Job title',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_lead', 'update_lead'],
      },
    },
    {
      id: 'department',
      title: 'Department',
      type: 'short-input',
      placeholder: 'Department',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    {
      id: 'mailingStreet',
      title: 'Mailing Street',
      type: 'short-input',
      placeholder: 'Mailing street address',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    {
      id: 'mailingCity',
      title: 'Mailing City',
      type: 'short-input',
      placeholder: 'Mailing city',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    {
      id: 'mailingState',
      title: 'Mailing State',
      type: 'short-input',
      placeholder: 'Mailing state/province',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    {
      id: 'mailingPostalCode',
      title: 'Mailing Postal Code',
      type: 'short-input',
      placeholder: 'Mailing postal code',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    {
      id: 'mailingCountry',
      title: 'Mailing Country',
      type: 'short-input',
      placeholder: 'Mailing country',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    // Lead fields
    {
      id: 'leadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: 'Lead ID',
      condition: { field: 'operation', value: ['get_leads', 'update_lead', 'delete_lead'] },
      required: { field: 'operation', value: ['update_lead', 'delete_lead'] },
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Company name',
      condition: { field: 'operation', value: ['create_lead', 'update_lead'] },
      required: { field: 'operation', value: ['create_lead'] },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'Status',
      condition: {
        field: 'operation',
        value: [
          'create_lead',
          'update_lead',
          'create_case',
          'update_case',
          'create_task',
          'update_task',
        ],
      },
    },
    {
      id: 'leadSource',
      title: 'Lead Source',
      type: 'short-input',
      placeholder: 'Lead source',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_lead', 'update_lead'] },
    },
    // Opportunity fields
    {
      id: 'opportunityId',
      title: 'Opportunity ID',
      type: 'short-input',
      placeholder: 'Opportunity ID',
      condition: {
        field: 'operation',
        value: ['get_opportunities', 'update_opportunity', 'delete_opportunity'],
      },
      required: { field: 'operation', value: ['update_opportunity', 'delete_opportunity'] },
    },
    {
      id: 'stageName',
      title: 'Stage Name',
      type: 'short-input',
      placeholder: 'Stage name',
      condition: { field: 'operation', value: ['create_opportunity', 'update_opportunity'] },
      required: { field: 'operation', value: ['create_opportunity'] },
    },
    {
      id: 'closeDate',
      title: 'Close Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (required for create)',
      condition: { field: 'operation', value: ['create_opportunity', 'update_opportunity'] },
      required: { field: 'operation', value: ['create_opportunity'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "end of quarter" -> Calculate the last day of the current quarter
- "next month" -> Calculate the last day of next month
- "in 90 days" -> Calculate the date 90 days from now

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the close date (e.g., "end of quarter", "in 90 days")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: 'Deal amount',
      condition: { field: 'operation', value: ['create_opportunity', 'update_opportunity'] },
    },
    {
      id: 'probability',
      title: 'Probability',
      type: 'short-input',
      placeholder: 'Win probability (0-100)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_opportunity', 'update_opportunity'] },
    },
    // Case fields
    {
      id: 'caseId',
      title: 'Case ID',
      type: 'short-input',
      placeholder: 'Case ID',
      condition: { field: 'operation', value: ['get_cases', 'update_case', 'delete_case'] },
      required: { field: 'operation', value: ['update_case', 'delete_case'] },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Subject',
      condition: {
        field: 'operation',
        value: ['create_case', 'update_case', 'create_task', 'update_task'],
      },
      required: { field: 'operation', value: ['create_case', 'create_task'] },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Priority',
      condition: {
        field: 'operation',
        value: ['create_case', 'update_case', 'create_task', 'update_task'],
      },
    },
    {
      id: 'origin',
      title: 'Origin',
      type: 'short-input',
      placeholder: 'Origin (e.g., Phone, Email, Web)',
      condition: { field: 'operation', value: ['create_case', 'update_case'] },
      mode: 'advanced',
    },
    // Task fields
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Task ID',
      condition: { field: 'operation', value: ['get_tasks', 'update_task', 'delete_task'] },
      required: { field: 'operation', value: ['update_task', 'delete_task'] },
    },
    {
      id: 'activityDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "tomorrow" -> Calculate tomorrow's date
- "next Friday" -> Calculate the next Friday's date
- "in 3 days" -> Calculate the date 3 days from now

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the due date (e.g., "tomorrow", "next Friday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'whoId',
      title: 'Related Contact/Lead ID',
      type: 'short-input',
      placeholder: 'Contact or Lead ID',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      mode: 'advanced',
    },
    {
      id: 'whatId',
      title: 'Related Account/Opportunity ID',
      type: 'short-input',
      placeholder: 'Account or Opportunity ID',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      mode: 'advanced',
    },
    // Report fields
    {
      id: 'reportId',
      title: 'Report ID',
      type: 'short-input',
      placeholder: 'Report ID',
      condition: { field: 'operation', value: ['get_report', 'run_report'] },
      required: true,
    },
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Search reports by name',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_reports'] },
    },
    {
      id: 'includeDetails',
      title: 'Include Details',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: ['run_report'] },
    },
    {
      id: 'filters',
      title: 'Report Filters',
      type: 'long-input',
      placeholder: 'JSON array of report filters',
      mode: 'advanced',
      condition: { field: 'operation', value: ['run_report'] },
    },
    // Dashboard fields
    {
      id: 'dashboardId',
      title: 'Dashboard ID',
      type: 'short-input',
      placeholder: 'Dashboard ID',
      condition: { field: 'operation', value: ['get_dashboard', 'refresh_dashboard'] },
      required: true,
    },
    // Query fields
    {
      id: 'query',
      title: 'SOQL Query',
      type: 'long-input',
      placeholder: 'SELECT Id, Name FROM Account LIMIT 10',
      condition: { field: 'operation', value: ['query', 'tooling_query'] },
      required: { field: 'operation', value: ['query', 'tooling_query'] },
    },
    {
      id: 'nextRecordsUrl',
      title: 'Next Records URL',
      type: 'short-input',
      placeholder: 'URL from previous query response',
      condition: { field: 'operation', value: ['query_more'] },
      required: true,
    },
    {
      id: 'objectName',
      title: 'Object Name',
      type: 'short-input',
      placeholder: 'API name (e.g., Account, Lead, Custom_Object__c)',
      condition: {
        field: 'operation',
        value: ['describe_object', 'create_custom_field', 'create_custom_object'],
      },
      required: {
        field: 'operation',
        value: ['describe_object', 'create_custom_field', 'create_custom_object'],
      },
    },
    // Long-input fields at the bottom
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'create_account',
          'update_account',
          'create_contact',
          'update_contact',
          'create_lead',
          'update_lead',
          'create_opportunity',
          'update_opportunity',
          'create_case',
          'update_case',
          'create_task',
          'update_task',
          'create_custom_field',
          'update_custom_field',
          'create_custom_object',
        ],
      },
    },
    // Schema / metadata fields (Tooling API)
    {
      id: 'fieldName',
      title: 'Field Name',
      type: 'short-input',
      placeholder: 'API name without __c (e.g., Region)',
      condition: { field: 'operation', value: ['create_custom_field'] },
      required: { field: 'operation', value: ['create_custom_field'] },
    },
    {
      id: 'fieldId',
      title: 'Field ID',
      type: 'short-input',
      placeholder: 'Tooling API Id (find via Run Tooling Query)',
      condition: { field: 'operation', value: ['update_custom_field', 'delete_custom_field'] },
      required: { field: 'operation', value: ['update_custom_field', 'delete_custom_field'] },
    },
    {
      id: 'fieldType',
      title: 'Field Type',
      type: 'dropdown',
      options: [
        { label: 'Text', id: 'Text' },
        { label: 'Text Area', id: 'TextArea' },
        { label: 'Text Area (Long)', id: 'LongTextArea' },
        { label: 'Rich Text Area', id: 'Html' },
        { label: 'Number', id: 'Number' },
        { label: 'Currency', id: 'Currency' },
        { label: 'Percent', id: 'Percent' },
        { label: 'Checkbox', id: 'Checkbox' },
        { label: 'Date', id: 'Date' },
        { label: 'Date/Time', id: 'DateTime' },
        { label: 'Time', id: 'Time' },
        { label: 'Phone', id: 'Phone' },
        { label: 'Email', id: 'Email' },
        { label: 'URL', id: 'Url' },
        { label: 'Picklist', id: 'Picklist' },
        { label: 'Picklist (Multi-Select)', id: 'MultiselectPicklist' },
      ],
      condition: { field: 'operation', value: ['create_custom_field'] },
      required: { field: 'operation', value: ['create_custom_field'] },
    },
    {
      id: 'label',
      title: 'Label',
      type: 'short-input',
      placeholder: 'Display label',
      condition: {
        field: 'operation',
        value: ['create_custom_field', 'update_custom_field', 'create_custom_object'],
      },
      required: { field: 'operation', value: ['create_custom_object'] },
    },
    {
      id: 'pluralLabel',
      title: 'Plural Label',
      type: 'short-input',
      placeholder: 'Plural display label (e.g., Projects)',
      condition: { field: 'operation', value: ['create_custom_object'] },
      required: { field: 'operation', value: ['create_custom_object'] },
    },
    {
      id: 'picklistValues',
      title: 'Picklist Values',
      type: 'short-input',
      placeholder: 'Comma-separated values (e.g., Low, Medium, High)',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'length',
      title: 'Length',
      type: 'short-input',
      placeholder: 'Max length for Text/LongTextArea/Html',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'precision',
      title: 'Precision',
      type: 'short-input',
      placeholder: 'Total digits for Number/Currency/Percent',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'scale',
      title: 'Scale',
      type: 'short-input',
      placeholder: 'Decimal places for numeric fields',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'visibleLines',
      title: 'Visible Lines',
      type: 'short-input',
      placeholder: 'Lines for LongTextArea/Html/MultiselectPicklist',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'defaultValue',
      title: 'Default Value',
      type: 'short-input',
      placeholder: 'Default value (true/false for Checkbox)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'inlineHelpText',
      title: 'Help Text',
      type: 'short-input',
      placeholder: 'Help text shown next to the field',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'required',
      title: 'Required',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'unique',
      title: 'Unique',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_field', 'update_custom_field'] },
    },
    {
      id: 'nameFieldLabel',
      title: 'Name Field Label',
      type: 'short-input',
      placeholder: 'Label for the Name field (defaults to "<label> Name")',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_object'] },
    },
    {
      id: 'sharingModel',
      title: 'Sharing Model',
      type: 'dropdown',
      options: [
        { label: 'Read/Write', id: 'ReadWrite' },
        { label: 'Read Only', id: 'Read' },
        { label: 'Private', id: 'Private' },
        { label: 'Controlled By Parent', id: 'ControlledByParent' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_custom_object'] },
    },
    ...getTrigger('salesforce_record_created').subBlocks,
    ...getTrigger('salesforce_record_updated').subBlocks,
    ...getTrigger('salesforce_record_deleted').subBlocks,
    ...getTrigger('salesforce_opportunity_stage_changed').subBlocks,
    ...getTrigger('salesforce_case_status_changed').subBlocks,
    ...getTrigger('salesforce_webhook').subBlocks,
  ],
  tools: {
    access: [
      'salesforce_get_accounts',
      'salesforce_create_account',
      'salesforce_update_account',
      'salesforce_delete_account',
      'salesforce_get_contacts',
      'salesforce_create_contact',
      'salesforce_update_contact',
      'salesforce_delete_contact',
      'salesforce_get_leads',
      'salesforce_create_lead',
      'salesforce_update_lead',
      'salesforce_delete_lead',
      'salesforce_get_opportunities',
      'salesforce_create_opportunity',
      'salesforce_update_opportunity',
      'salesforce_delete_opportunity',
      'salesforce_get_cases',
      'salesforce_create_case',
      'salesforce_update_case',
      'salesforce_delete_case',
      'salesforce_get_tasks',
      'salesforce_create_task',
      'salesforce_update_task',
      'salesforce_delete_task',
      'salesforce_list_reports',
      'salesforce_get_report',
      'salesforce_run_report',
      'salesforce_list_report_types',
      'salesforce_list_dashboards',
      'salesforce_get_dashboard',
      'salesforce_refresh_dashboard',
      'salesforce_query',
      'salesforce_query_more',
      'salesforce_describe_object',
      'salesforce_list_objects',
      'salesforce_create_custom_field',
      'salesforce_update_custom_field',
      'salesforce_delete_custom_field',
      'salesforce_create_custom_object',
      'salesforce_tooling_query',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_accounts':
            return 'salesforce_get_accounts'
          case 'create_account':
            return 'salesforce_create_account'
          case 'update_account':
            return 'salesforce_update_account'
          case 'delete_account':
            return 'salesforce_delete_account'
          case 'get_contacts':
            return 'salesforce_get_contacts'
          case 'create_contact':
            return 'salesforce_create_contact'
          case 'update_contact':
            return 'salesforce_update_contact'
          case 'delete_contact':
            return 'salesforce_delete_contact'
          case 'get_leads':
            return 'salesforce_get_leads'
          case 'create_lead':
            return 'salesforce_create_lead'
          case 'update_lead':
            return 'salesforce_update_lead'
          case 'delete_lead':
            return 'salesforce_delete_lead'
          case 'get_opportunities':
            return 'salesforce_get_opportunities'
          case 'create_opportunity':
            return 'salesforce_create_opportunity'
          case 'update_opportunity':
            return 'salesforce_update_opportunity'
          case 'delete_opportunity':
            return 'salesforce_delete_opportunity'
          case 'get_cases':
            return 'salesforce_get_cases'
          case 'create_case':
            return 'salesforce_create_case'
          case 'update_case':
            return 'salesforce_update_case'
          case 'delete_case':
            return 'salesforce_delete_case'
          case 'get_tasks':
            return 'salesforce_get_tasks'
          case 'create_task':
            return 'salesforce_create_task'
          case 'update_task':
            return 'salesforce_update_task'
          case 'delete_task':
            return 'salesforce_delete_task'
          case 'list_reports':
            return 'salesforce_list_reports'
          case 'get_report':
            return 'salesforce_get_report'
          case 'run_report':
            return 'salesforce_run_report'
          case 'list_report_types':
            return 'salesforce_list_report_types'
          case 'list_dashboards':
            return 'salesforce_list_dashboards'
          case 'get_dashboard':
            return 'salesforce_get_dashboard'
          case 'refresh_dashboard':
            return 'salesforce_refresh_dashboard'
          case 'query':
            return 'salesforce_query'
          case 'query_more':
            return 'salesforce_query_more'
          case 'describe_object':
            return 'salesforce_describe_object'
          case 'list_objects':
            return 'salesforce_list_objects'
          case 'create_custom_field':
            return 'salesforce_create_custom_field'
          case 'update_custom_field':
            return 'salesforce_update_custom_field'
          case 'delete_custom_field':
            return 'salesforce_delete_custom_field'
          case 'create_custom_object':
            return 'salesforce_create_custom_object'
          case 'tooling_query':
            return 'salesforce_tooling_query'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, ...rest } = params
        const cleanParams: Record<string, any> = { oauthCredential }
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })
        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Salesforce credential' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'json',
      description:
        'Operation result: sObject record(s) for get/create/update/delete ops (accounts, contacts, leads, opportunities, cases, tasks); report/dashboard payloads for analytics ops; records[] + paging for SOQL query ops; sObject schema for describe/list-objects ops',
    },
  },
}
