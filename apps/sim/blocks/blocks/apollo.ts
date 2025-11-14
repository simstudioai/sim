import { ApolloIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ApolloResponse } from '@/tools/apollo/types'

export const ApolloBlock: BlockConfig<ApolloResponse> = {
  type: 'apollo',
  name: 'Apollo',
  description: 'Search, enrich, and manage contacts with Apollo.io',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates Apollo.io into the workflow. Search for people and companies, enrich contact data, manage your CRM contacts and accounts, add contacts to sequences, and create tasks.',
  docsLink: 'https://docs.sim.ai/tools/apollo',
  category: 'tools',
  bgColor: '#EBF212',
  icon: ApolloIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search People', id: 'people_search' },
        { label: 'Enrich Person', id: 'people_enrich' },
        { label: 'Bulk Enrich People', id: 'people_bulk_enrich' },
        { label: 'Search Organizations', id: 'organization_search' },
        { label: 'Enrich Organization', id: 'organization_enrich' },
        { label: 'Bulk Enrich Organizations', id: 'organization_bulk_enrich' },
        { label: 'Create Contact', id: 'contact_create' },
        { label: 'Update Contact', id: 'contact_update' },
        { label: 'Search Contacts', id: 'contact_search' },
        { label: 'Bulk Create Contacts', id: 'contact_bulk_create' },
        { label: 'Bulk Update Contacts', id: 'contact_bulk_update' },
        { label: 'Create Account', id: 'account_create' },
        { label: 'Update Account', id: 'account_update' },
        { label: 'Search Accounts', id: 'account_search' },
        { label: 'Bulk Create Accounts', id: 'account_bulk_create' },
        { label: 'Bulk Update Accounts', id: 'account_bulk_update' },
        { label: 'Create Opportunity', id: 'opportunity_create' },
        { label: 'Search Opportunities', id: 'opportunity_search' },
        { label: 'Get Opportunity', id: 'opportunity_get' },
        { label: 'Update Opportunity', id: 'opportunity_update' },
        { label: 'Search Sequences', id: 'sequence_search' },
        { label: 'Add to Sequence', id: 'sequence_add' },
        { label: 'Create Task', id: 'task_create' },
        { label: 'Search Tasks', id: 'task_search' },
        { label: 'Get Email Accounts', id: 'email_accounts' },
      ],
      value: () => 'people_search',
    },
    {
      id: 'apiKey',
      title: 'Apollo API Key',
      type: 'short-input',
      placeholder: 'Enter your Apollo API key',
      password: true,
      required: true,
    },

    // People Search Fields
    {
      id: 'person_titles',
      title: 'Job Titles',
      type: 'code',
      placeholder: '["CEO", "VP of Sales"]',
      condition: { field: 'operation', value: 'people_search' },
    },
    {
      id: 'person_locations',
      title: 'Locations',
      type: 'code',
      placeholder: '["San Francisco, CA", "New York, NY"]',
      condition: { field: 'operation', value: 'people_search' },
    },
    {
      id: 'organization_names',
      title: 'Company Names',
      type: 'code',
      placeholder: '["Company A", "Company B"]',
      condition: { field: 'operation', value: 'people_search' },
    },
    {
      id: 'person_seniorities',
      title: 'Seniority Levels',
      type: 'code',
      placeholder: '["senior", "manager", "director"]',
      condition: { field: 'operation', value: 'people_search' },
    },
    {
      id: 'contact_stage_ids',
      title: 'Contact Stage IDs',
      type: 'code',
      placeholder: '["stage_id_1", "stage_id_2"]',
      condition: { field: 'operation', value: 'contact_search' },
    },

    // People Enrich Fields
    {
      id: 'first_name',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'contact_create', 'contact_update'],
      },
      required: {
        field: 'operation',
        value: 'contact_create',
      },
    },
    {
      id: 'last_name',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'contact_create', 'contact_update'],
      },
      required: {
        field: 'operation',
        value: 'contact_create',
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'email@example.com',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'contact_create', 'contact_update'],
      },
    },
    {
      id: 'organization_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Company name',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'organization_enrich'],
      },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'organization_enrich'],
      },
    },
    {
      id: 'reveal_personal_emails',
      title: 'Reveal Personal Emails',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'people_bulk_enrich'],
      },
    },
    {
      id: 'reveal_phone_number',
      title: 'Reveal Phone Numbers',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['people_enrich', 'people_bulk_enrich'],
      },
    },

    // Bulk Enrich Fields
    {
      id: 'people',
      title: 'People (JSON Array)',
      type: 'code',
      placeholder: '[{"first_name": "John", "last_name": "Doe", "email": "john@example.com"}]',
      condition: { field: 'operation', value: 'people_bulk_enrich' },
      required: true,
    },
    {
      id: 'organizations',
      title: 'Organizations (JSON Array)',
      type: 'code',
      placeholder: '[{"organization_name": "Company A", "domain": "companya.com"}]',
      condition: { field: 'operation', value: 'organization_bulk_enrich' },
      required: true,
    },

    // Organization Search Fields
    {
      id: 'organization_locations',
      title: 'Organization Locations',
      type: 'code',
      placeholder: '["San Francisco, CA"]',
      condition: { field: 'operation', value: 'organization_search' },
    },
    {
      id: 'organization_num_employees_ranges',
      title: 'Employee Count Ranges',
      type: 'code',
      placeholder: '["1-10", "11-50", "51-200"]',
      condition: { field: 'operation', value: 'organization_search' },
    },
    {
      id: 'q_organization_keyword_tags',
      title: 'Keyword Tags',
      type: 'code',
      placeholder: '["saas", "b2b", "enterprise"]',
      condition: { field: 'operation', value: 'organization_search' },
    },
    {
      id: 'q_organization_name',
      title: 'Organization Name',
      type: 'short-input',
      placeholder: 'Company name to search',
      condition: { field: 'operation', value: 'organization_search' },
    },

    // Contact Fields
    {
      id: 'contact_id',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Apollo contact ID',
      condition: { field: 'operation', value: 'contact_update' },
      required: true,
    },
    {
      id: 'title',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Job title',
      condition: {
        field: 'operation',
        value: ['contact_create', 'contact_update'],
      },
    },
    {
      id: 'account_id',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Apollo account ID',
      condition: {
        field: 'operation',
        value: [
          'contact_create',
          'contact_update',
          'account_update',
          'task_create',
          'opportunity_create',
        ],
      },
      required: {
        field: 'operation',
        value: ['account_update', 'opportunity_create'],
      },
    },
    {
      id: 'owner_id',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'Apollo user ID',
      condition: {
        field: 'operation',
        value: [
          'contact_create',
          'contact_update',
          'account_create',
          'account_update',
          'account_search',
          'opportunity_create',
          'opportunity_update',
        ],
      },
    },

    // Contact Bulk Operations
    {
      id: 'contacts',
      title: 'Contacts (JSON Array)',
      type: 'code',
      placeholder:
        '[{"first_name": "John", "last_name": "Doe", "email": "john@example.com", "title": "CEO"}]',
      condition: { field: 'operation', value: 'contact_bulk_create' },
      required: true,
    },
    {
      id: 'contacts',
      title: 'Contacts (JSON Array)',
      type: 'code',
      placeholder: '[{"id": "contact_id_1", "first_name": "John", "last_name": "Doe"}]',
      condition: { field: 'operation', value: 'contact_bulk_update' },
      required: true,
    },
    {
      id: 'run_dedupe',
      title: 'Run Deduplication',
      type: 'switch',
      condition: { field: 'operation', value: 'contact_bulk_create' },
    },

    // Account Fields
    {
      id: 'account_name',
      title: 'Account Name',
      type: 'short-input',
      placeholder: 'Company name',
      condition: {
        field: 'operation',
        value: ['account_create', 'account_update'],
      },
      required: {
        field: 'operation',
        value: 'account_create',
      },
    },
    {
      id: 'website_url',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: {
        field: 'operation',
        value: ['account_create', 'account_update'],
      },
    },
    {
      id: 'phone',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: 'Company phone',
      condition: {
        field: 'operation',
        value: ['account_create', 'account_update'],
      },
    },

    // Account Search Fields
    {
      id: 'q_keywords',
      title: 'Keywords',
      type: 'short-input',
      placeholder: 'Search keywords',
      condition: {
        field: 'operation',
        value: ['people_search', 'contact_search', 'account_search', 'opportunity_search'],
      },
    },
    {
      id: 'account_stage_ids',
      title: 'Account Stage IDs',
      type: 'code',
      placeholder: '["stage_id_1", "stage_id_2"]',
      condition: { field: 'operation', value: 'account_search' },
    },

    // Account Bulk Operations
    {
      id: 'accounts',
      title: 'Accounts (JSON Array)',
      type: 'code',
      placeholder:
        '[{"name": "Company A", "website_url": "https://companya.com", "phone": "+1234567890"}]',
      condition: { field: 'operation', value: 'account_bulk_create' },
      required: true,
    },
    {
      id: 'accounts',
      title: 'Accounts (JSON Array)',
      type: 'code',
      placeholder: '[{"id": "account_id_1", "name": "Updated Company Name"}]',
      condition: { field: 'operation', value: 'account_bulk_update' },
      required: true,
    },

    // Opportunity Fields
    {
      id: 'opportunity_name',
      title: 'Opportunity Name',
      type: 'short-input',
      placeholder: 'Opportunity name',
      condition: {
        field: 'operation',
        value: ['opportunity_create', 'opportunity_update'],
      },
      required: {
        field: 'operation',
        value: 'opportunity_create',
      },
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: 'Deal amount (e.g., 50000)',
      condition: {
        field: 'operation',
        value: ['opportunity_create', 'opportunity_update'],
      },
    },
    {
      id: 'stage_id',
      title: 'Stage ID',
      type: 'short-input',
      placeholder: 'Opportunity stage ID',
      condition: {
        field: 'operation',
        value: ['opportunity_create', 'opportunity_update'],
      },
    },
    {
      id: 'close_date',
      title: 'Close Date',
      type: 'short-input',
      placeholder: 'ISO date (e.g., 2024-12-31)',
      condition: {
        field: 'operation',
        value: ['opportunity_create', 'opportunity_update'],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Opportunity description',
      condition: {
        field: 'operation',
        value: ['opportunity_create', 'opportunity_update'],
      },
    },

    // Opportunity Get
    {
      id: 'opportunity_id',
      title: 'Opportunity ID',
      type: 'short-input',
      placeholder: 'Apollo opportunity ID',
      condition: {
        field: 'operation',
        value: ['opportunity_get', 'opportunity_update'],
      },
      required: true,
    },

    // Opportunity Search Fields
    {
      id: 'account_ids',
      title: 'Account IDs',
      type: 'code',
      placeholder: '["account_id_1", "account_id_2"]',
      condition: { field: 'operation', value: 'opportunity_search' },
    },
    {
      id: 'stage_ids',
      title: 'Stage IDs',
      type: 'code',
      placeholder: '["stage_id_1", "stage_id_2"]',
      condition: { field: 'operation', value: 'opportunity_search' },
    },
    {
      id: 'owner_ids',
      title: 'Owner IDs',
      type: 'code',
      placeholder: '["user_id_1", "user_id_2"]',
      condition: { field: 'operation', value: 'opportunity_search' },
    },

    // Sequence Search Fields
    {
      id: 'q_name',
      title: 'Sequence Name',
      type: 'short-input',
      placeholder: 'Search by sequence name',
      condition: { field: 'operation', value: 'sequence_search' },
    },
    {
      id: 'active',
      title: 'Active Only',
      type: 'switch',
      condition: { field: 'operation', value: 'sequence_search' },
    },

    // Sequence Fields
    {
      id: 'sequence_id',
      title: 'Sequence ID',
      type: 'short-input',
      placeholder: 'Apollo sequence ID',
      condition: { field: 'operation', value: 'sequence_add' },
      required: true,
    },
    {
      id: 'contact_ids',
      title: 'Contact IDs (JSON Array)',
      type: 'code',
      placeholder: '["contact_id_1", "contact_id_2"]',
      condition: { field: 'operation', value: 'sequence_add' },
      required: true,
    },

    // Task Fields
    {
      id: 'note',
      title: 'Task Note',
      type: 'long-input',
      placeholder: 'Task description',
      condition: { field: 'operation', value: 'task_create' },
      required: true,
    },
    {
      id: 'due_at',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'ISO date (e.g., 2024-12-31T23:59:59Z)',
      condition: { field: 'operation', value: 'task_create' },
    },
    {
      id: 'completed',
      title: 'Completed',
      type: 'switch',
      condition: { field: 'operation', value: 'task_search' },
    },

    // Pagination
    {
      id: 'page',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: [
          'people_search',
          'organization_search',
          'contact_search',
          'account_search',
          'opportunity_search',
          'sequence_search',
          'task_search',
        ],
      },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '25 (max: 100)',
      condition: {
        field: 'operation',
        value: [
          'people_search',
          'organization_search',
          'contact_search',
          'account_search',
          'opportunity_search',
          'sequence_search',
          'task_search',
        ],
      },
    },
  ],
  tools: {
    access: [
      'apollo_people_search',
      'apollo_people_enrich',
      'apollo_people_bulk_enrich',
      'apollo_organization_search',
      'apollo_organization_enrich',
      'apollo_organization_bulk_enrich',
      'apollo_contact_create',
      'apollo_contact_update',
      'apollo_contact_search',
      'apollo_contact_bulk_create',
      'apollo_contact_bulk_update',
      'apollo_account_create',
      'apollo_account_update',
      'apollo_account_search',
      'apollo_account_bulk_create',
      'apollo_account_bulk_update',
      'apollo_opportunity_create',
      'apollo_opportunity_search',
      'apollo_opportunity_get',
      'apollo_opportunity_update',
      'apollo_sequence_search',
      'apollo_sequence_add_contacts',
      'apollo_task_create',
      'apollo_task_search',
      'apollo_email_accounts',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'people_search':
            return 'apollo_people_search'
          case 'people_enrich':
            return 'apollo_people_enrich'
          case 'people_bulk_enrich':
            return 'apollo_people_bulk_enrich'
          case 'organization_search':
            return 'apollo_organization_search'
          case 'organization_enrich':
            return 'apollo_organization_enrich'
          case 'organization_bulk_enrich':
            return 'apollo_organization_bulk_enrich'
          case 'contact_create':
            return 'apollo_contact_create'
          case 'contact_update':
            return 'apollo_contact_update'
          case 'contact_search':
            return 'apollo_contact_search'
          case 'contact_bulk_create':
            return 'apollo_contact_bulk_create'
          case 'contact_bulk_update':
            return 'apollo_contact_bulk_update'
          case 'account_create':
            return 'apollo_account_create'
          case 'account_update':
            return 'apollo_account_update'
          case 'account_search':
            return 'apollo_account_search'
          case 'account_bulk_create':
            return 'apollo_account_bulk_create'
          case 'account_bulk_update':
            return 'apollo_account_bulk_update'
          case 'opportunity_create':
            return 'apollo_opportunity_create'
          case 'opportunity_search':
            return 'apollo_opportunity_search'
          case 'opportunity_get':
            return 'apollo_opportunity_get'
          case 'opportunity_update':
            return 'apollo_opportunity_update'
          case 'sequence_search':
            return 'apollo_sequence_search'
          case 'sequence_add':
            return 'apollo_sequence_add_contacts'
          case 'task_create':
            return 'apollo_task_create'
          case 'task_search':
            return 'apollo_task_search'
          case 'email_accounts':
            return 'apollo_email_accounts'
          default:
            throw new Error(`Invalid Apollo operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { apiKey, ...rest } = params

        // Parse JSON inputs safely
        const parsedParams: any = { apiKey, ...rest }

        try {
          if (rest.person_titles && typeof rest.person_titles === 'string') {
            parsedParams.person_titles = JSON.parse(rest.person_titles)
          }
          if (rest.person_locations && typeof rest.person_locations === 'string') {
            parsedParams.person_locations = JSON.parse(rest.person_locations)
          }
          if (rest.person_seniorities && typeof rest.person_seniorities === 'string') {
            parsedParams.person_seniorities = JSON.parse(rest.person_seniorities)
          }
          if (rest.organization_names && typeof rest.organization_names === 'string') {
            parsedParams.organization_names = JSON.parse(rest.organization_names)
          }
          if (rest.organization_locations && typeof rest.organization_locations === 'string') {
            parsedParams.organization_locations = JSON.parse(rest.organization_locations)
          }
          if (
            rest.organization_num_employees_ranges &&
            typeof rest.organization_num_employees_ranges === 'string'
          ) {
            parsedParams.organization_num_employees_ranges = JSON.parse(
              rest.organization_num_employees_ranges
            )
          }
          if (
            rest.q_organization_keyword_tags &&
            typeof rest.q_organization_keyword_tags === 'string'
          ) {
            parsedParams.q_organization_keyword_tags = JSON.parse(rest.q_organization_keyword_tags)
          }
          if (rest.contact_stage_ids && typeof rest.contact_stage_ids === 'string') {
            parsedParams.contact_stage_ids = JSON.parse(rest.contact_stage_ids)
          }
          if (rest.account_stage_ids && typeof rest.account_stage_ids === 'string') {
            parsedParams.account_stage_ids = JSON.parse(rest.account_stage_ids)
          }
          if (rest.people && typeof rest.people === 'string') {
            parsedParams.people = JSON.parse(rest.people)
          }
          if (rest.organizations && typeof rest.organizations === 'string') {
            parsedParams.organizations = JSON.parse(rest.organizations)
          }
          if (rest.contacts && typeof rest.contacts === 'string') {
            parsedParams.contacts = JSON.parse(rest.contacts)
          }
          if (rest.accounts && typeof rest.accounts === 'string') {
            parsedParams.accounts = JSON.parse(rest.accounts)
          }
          if (rest.contact_ids && typeof rest.contact_ids === 'string') {
            parsedParams.contact_ids = JSON.parse(rest.contact_ids)
          }
          if (rest.account_ids && typeof rest.account_ids === 'string') {
            parsedParams.account_ids = JSON.parse(rest.account_ids)
          }
          if (rest.stage_ids && typeof rest.stage_ids === 'string') {
            parsedParams.stage_ids = JSON.parse(rest.stage_ids)
          }
          if (rest.owner_ids && typeof rest.owner_ids === 'string') {
            parsedParams.owner_ids = JSON.parse(rest.owner_ids)
          }
        } catch (error: any) {
          throw new Error(`Invalid JSON input: ${error.message}`)
        }

        // Map UI field names to API parameter names
        if (params.operation === 'account_create' || params.operation === 'account_update') {
          if (rest.account_name) parsedParams.name = rest.account_name
          parsedParams.account_name = undefined
        }

        if (params.operation === 'account_update') {
          parsedParams.account_id = rest.account_id
        }

        if (
          params.operation === 'opportunity_create' ||
          params.operation === 'opportunity_update'
        ) {
          if (rest.opportunity_name) parsedParams.name = rest.opportunity_name
          parsedParams.opportunity_name = undefined
        }

        // Convert page/per_page to numbers if provided
        if (parsedParams.page) parsedParams.page = Number(parsedParams.page)
        if (parsedParams.per_page) parsedParams.per_page = Number(parsedParams.per_page)

        // Convert amount to number if provided
        if (parsedParams.amount) parsedParams.amount = Number(parsedParams.amount)

        return parsedParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Apollo operation to perform' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation was successful' },
    output: { type: 'json', description: 'Output data from the Apollo operation' },
  },
}
