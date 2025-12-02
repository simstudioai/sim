import { PylonIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const PylonBlock: BlockConfig = {
  type: 'pylon',
  name: 'Pylon',
  description:
    'Manage customer support issues, accounts, contacts, users, teams, and tags in Pylon',
  longDescription:
    'Integrate Pylon into the workflow. Manage issues (list, create, get, update, delete, search, snooze, followers, external issues), accounts (list, create, get, update, delete, bulk update, search), contacts (list, create, get, update, delete, search), users (list, get, update, search), teams (list, get, create, update), tags (list, get, create, update, delete), and messages (redact).',
  docsLink: 'https://docs.usepylon.com/pylon-docs/developer/api',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  bgColor: '#E8F4FA',
  icon: PylonIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Issue operations
        { label: 'List Issues', id: 'list_issues' },
        { label: 'Create Issue', id: 'create_issue' },
        { label: 'Get Issue', id: 'get_issue' },
        { label: 'Update Issue', id: 'update_issue' },
        { label: 'Delete Issue', id: 'delete_issue' },
        { label: 'Search Issues', id: 'search_issues' },
        { label: 'Snooze Issue', id: 'snooze_issue' },
        { label: 'List Issue Followers', id: 'list_issue_followers' },
        { label: 'Manage Issue Followers', id: 'manage_issue_followers' },
        { label: 'Link External Issue', id: 'link_external_issue' },
        // Account operations
        { label: 'List Accounts', id: 'list_accounts' },
        { label: 'Create Account', id: 'create_account' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'Update Account', id: 'update_account' },
        { label: 'Delete Account', id: 'delete_account' },
        { label: 'Bulk Update Accounts', id: 'bulk_update_accounts' },
        { label: 'Search Accounts', id: 'search_accounts' },
        // Contact operations
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        // User operations
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Update User', id: 'update_user' },
        { label: 'Search Users', id: 'search_users' },
        // Team operations
        { label: 'List Teams', id: 'list_teams' },
        { label: 'Get Team', id: 'get_team' },
        { label: 'Create Team', id: 'create_team' },
        { label: 'Update Team', id: 'update_team' },
        // Tag operations
        { label: 'List Tags', id: 'list_tags' },
        { label: 'Get Tag', id: 'get_tag' },
        { label: 'Create Tag', id: 'create_tag' },
        { label: 'Update Tag', id: 'update_tag' },
        { label: 'Delete Tag', id: 'delete_tag' },
        // Message operations
        { label: 'Redact Message', id: 'redact_message' },
      ],
      value: () => 'list_issues',
    },
    {
      id: 'apiToken',
      title: 'API Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Pylon API token',
      required: true,
    },
    // Issue fields
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'RFC3339 format (e.g., 2024-01-01T00:00:00Z)',
      required: true,
      condition: {
        field: 'operation',
        value: ['list_issues'],
      },
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'RFC3339 format (e.g., 2024-01-31T23:59:59Z)',
      required: true,
      condition: {
        field: 'operation',
        value: ['list_issues'],
      },
    },
    {
      id: 'issueId',
      title: 'Issue ID',
      type: 'short-input',
      placeholder: 'Issue ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'get_issue',
          'update_issue',
          'delete_issue',
          'snooze_issue',
          'list_issue_followers',
          'manage_issue_followers',
          'link_external_issue',
          'redact_message',
        ],
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Issue title',
      required: {
        field: 'operation',
        value: ['create_issue'],
      },
      condition: {
        field: 'operation',
        value: ['create_issue'],
      },
    },
    {
      id: 'bodyHtml',
      title: 'Body HTML',
      type: 'long-input',
      placeholder: 'Issue body in HTML format',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_issue'],
      },
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Account ID',
      condition: {
        field: 'operation',
        value: ['create_issue', 'update_issue', 'create_contact', 'update_contact'],
      },
    },
    {
      id: 'assigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      placeholder: 'User ID to assign to',
      condition: {
        field: 'operation',
        value: ['create_issue', 'update_issue'],
      },
    },
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'Team ID',
      required: {
        field: 'operation',
        value: ['get_team', 'update_team'],
      },
      condition: {
        field: 'operation',
        value: ['create_issue', 'update_issue', 'get_team', 'update_team'],
      },
    },
    {
      id: 'requesterId',
      title: 'Requester ID',
      type: 'short-input',
      placeholder: 'Requester user ID',
      condition: {
        field: 'operation',
        value: ['create_issue', 'update_issue'],
      },
    },
    {
      id: 'requesterEmail',
      title: 'Requester Email',
      type: 'short-input',
      placeholder: 'Requester email address',
      condition: {
        field: 'operation',
        value: ['create_issue'],
      },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Issue priority',
      condition: {
        field: 'operation',
        value: ['create_issue', 'update_issue'],
      },
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      placeholder: 'Issue state',
      condition: {
        field: 'operation',
        value: ['update_issue'],
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tag IDs',
      condition: {
        field: 'operation',
        value: [
          'create_issue',
          'update_issue',
          'create_account',
          'update_account',
          'bulk_update_accounts',
        ],
      },
    },
    {
      id: 'customFields',
      title: 'Custom Fields',
      type: 'long-input',
      placeholder: 'JSON object with custom fields',
      condition: {
        field: 'operation',
        value: [
          'create_issue',
          'update_issue',
          'create_account',
          'update_account',
          'bulk_update_accounts',
          'create_contact',
          'update_contact',
        ],
      },
    },
    {
      id: 'attachmentUrls',
      title: 'Attachment URLs',
      type: 'short-input',
      placeholder: 'Comma-separated attachment URLs',
      condition: {
        field: 'operation',
        value: ['create_issue'],
      },
    },
    {
      id: 'customerPortalVisible',
      title: 'Customer Portal Visible',
      type: 'short-input',
      placeholder: 'true or false',
      condition: {
        field: 'operation',
        value: ['update_issue'],
      },
    },
    {
      id: 'snoozeUntil',
      title: 'Snooze Until',
      type: 'short-input',
      placeholder: 'RFC3339 timestamp',
      required: true,
      condition: {
        field: 'operation',
        value: ['snooze_issue'],
      },
    },
    {
      id: 'userIds',
      title: 'User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      condition: {
        field: 'operation',
        value: ['manage_issue_followers', 'create_team', 'update_team'],
      },
    },
    {
      id: 'contactIds',
      title: 'Contact IDs',
      type: 'short-input',
      placeholder: 'Comma-separated contact IDs',
      condition: {
        field: 'operation',
        value: ['manage_issue_followers'],
      },
    },
    {
      id: 'followerOperation',
      title: 'Follower Operation',
      type: 'dropdown',
      options: [
        { label: 'Add', id: 'add' },
        { label: 'Remove', id: 'remove' },
      ],
      condition: {
        field: 'operation',
        value: ['manage_issue_followers'],
      },
    },
    {
      id: 'externalIssueId',
      title: 'External Issue ID',
      type: 'short-input',
      placeholder: 'External issue identifier',
      required: true,
      condition: {
        field: 'operation',
        value: ['link_external_issue'],
      },
    },
    {
      id: 'source',
      title: 'Source',
      type: 'short-input',
      placeholder: 'Source system (e.g., linear, jira)',
      required: true,
      condition: {
        field: 'operation',
        value: ['link_external_issue'],
      },
    },
    // Account fields
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Name',
      required: {
        field: 'operation',
        value: ['create_account', 'create_contact'],
      },
      condition: {
        field: 'operation',
        value: [
          'create_account',
          'update_account',
          'create_contact',
          'update_contact',
          'create_team',
          'update_team',
        ],
      },
    },
    {
      id: 'accountIdField',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Account ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_account', 'update_account', 'delete_account'],
      },
    },
    {
      id: 'accountIds',
      title: 'Account IDs',
      type: 'short-input',
      placeholder: 'Comma-separated account IDs',
      required: true,
      condition: {
        field: 'operation',
        value: ['bulk_update_accounts'],
      },
    },
    {
      id: 'domains',
      title: 'Domains',
      type: 'short-input',
      placeholder: 'Comma-separated domain names',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account'],
      },
    },
    {
      id: 'primaryDomain',
      title: 'Primary Domain',
      type: 'short-input',
      placeholder: 'Primary domain name',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account'],
      },
    },
    {
      id: 'channels',
      title: 'Channels',
      type: 'short-input',
      placeholder: 'Channels',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account'],
      },
    },
    {
      id: 'externalIds',
      title: 'External IDs',
      type: 'short-input',
      placeholder: 'External IDs',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account'],
      },
    },
    {
      id: 'ownerId',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'Owner user ID',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account', 'bulk_update_accounts'],
      },
    },
    {
      id: 'logoUrl',
      title: 'Logo URL',
      type: 'short-input',
      placeholder: 'Account logo URL',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account'],
      },
    },
    {
      id: 'subaccountIds',
      title: 'Subaccount IDs',
      type: 'short-input',
      placeholder: 'Comma-separated subaccount IDs',
      condition: {
        field: 'operation',
        value: ['create_account', 'update_account'],
      },
    },
    {
      id: 'tagsApplyMode',
      title: 'Tags Apply Mode',
      type: 'dropdown',
      options: [
        { label: 'Append Only', id: 'append_only' },
        { label: 'Remove Only', id: 'remove_only' },
        { label: 'Replace', id: 'replace' },
      ],
      condition: {
        field: 'operation',
        value: ['bulk_update_accounts'],
      },
    },
    // Contact fields
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Contact ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_contact', 'update_contact', 'delete_contact'],
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email address',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'accountExternalId',
      title: 'Account External ID',
      type: 'short-input',
      placeholder: 'External account ID',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'avatarUrl',
      title: 'Avatar URL',
      type: 'short-input',
      placeholder: 'Square PNG/JPG image URL',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'portalRole',
      title: 'Portal Role',
      type: 'dropdown',
      options: [
        { label: 'No Access', id: 'no_access' },
        { label: 'Member', id: 'member' },
        { label: 'Admin', id: 'admin' },
      ],
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    // User fields
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'User ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_user', 'update_user'],
      },
    },
    {
      id: 'roleId',
      title: 'Role ID',
      type: 'short-input',
      placeholder: 'Role ID',
      condition: {
        field: 'operation',
        value: ['update_user'],
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'active' },
        { label: 'Away', id: 'away' },
        { label: 'Out of Office', id: 'out_of_office' },
      ],
      condition: {
        field: 'operation',
        value: ['update_user'],
      },
    },
    // Tag fields
    {
      id: 'tagId',
      title: 'Tag ID',
      type: 'short-input',
      placeholder: 'Tag ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_tag', 'update_tag', 'delete_tag'],
      },
    },
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      options: [
        { label: 'Account', id: 'account' },
        { label: 'Issue', id: 'issue' },
        { label: 'Contact', id: 'contact' },
      ],
      required: true,
      condition: {
        field: 'operation',
        value: ['create_tag'],
      },
    },
    {
      id: 'value',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Tag value/name',
      required: {
        field: 'operation',
        value: ['create_tag'],
      },
      condition: {
        field: 'operation',
        value: ['create_tag', 'update_tag'],
      },
    },
    {
      id: 'hexColor',
      title: 'Hex Color',
      type: 'short-input',
      placeholder: 'Hex color code (e.g., #3a89ce)',
      condition: {
        field: 'operation',
        value: ['create_tag', 'update_tag'],
      },
    },
    // Message fields
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Message ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['redact_message'],
      },
    },
    // Search and pagination fields
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      placeholder: 'JSON filter object',
      required: {
        field: 'operation',
        value: ['search_accounts', 'search_contacts', 'search_users'],
      },
      condition: {
        field: 'operation',
        value: ['search_issues', 'search_accounts', 'search_contacts', 'search_users'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Results per page (1-1000, default: 100)',
      condition: {
        field: 'operation',
        value: [
          'list_accounts',
          'list_contacts',
          'get_contact',
          'search_issues',
          'search_accounts',
          'search_contacts',
          'search_users',
        ],
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor',
      condition: {
        field: 'operation',
        value: [
          'list_issues',
          'list_accounts',
          'list_contacts',
          'get_contact',
          'search_issues',
          'search_accounts',
          'search_contacts',
          'search_users',
        ],
      },
    },
  ],
  tools: {
    access: [
      'pylon_list_issues',
      'pylon_create_issue',
      'pylon_get_issue',
      'pylon_update_issue',
      'pylon_delete_issue',
      'pylon_search_issues',
      'pylon_snooze_issue',
      'pylon_list_issue_followers',
      'pylon_manage_issue_followers',
      'pylon_link_external_issue',
      'pylon_list_accounts',
      'pylon_create_account',
      'pylon_get_account',
      'pylon_update_account',
      'pylon_delete_account',
      'pylon_bulk_update_accounts',
      'pylon_search_accounts',
      'pylon_list_contacts',
      'pylon_create_contact',
      'pylon_get_contact',
      'pylon_update_contact',
      'pylon_delete_contact',
      'pylon_search_contacts',
      'pylon_list_users',
      'pylon_get_user',
      'pylon_update_user',
      'pylon_search_users',
      'pylon_list_teams',
      'pylon_get_team',
      'pylon_create_team',
      'pylon_update_team',
      'pylon_list_tags',
      'pylon_get_tag',
      'pylon_create_tag',
      'pylon_update_tag',
      'pylon_delete_tag',
      'pylon_redact_message',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          // Issue operations
          case 'list_issues':
            return 'pylon_list_issues'
          case 'create_issue':
            return 'pylon_create_issue'
          case 'get_issue':
            return 'pylon_get_issue'
          case 'update_issue':
            return 'pylon_update_issue'
          case 'delete_issue':
            return 'pylon_delete_issue'
          case 'search_issues':
            return 'pylon_search_issues'
          case 'snooze_issue':
            return 'pylon_snooze_issue'
          case 'list_issue_followers':
            return 'pylon_list_issue_followers'
          case 'manage_issue_followers':
            return 'pylon_manage_issue_followers'
          case 'link_external_issue':
            return 'pylon_link_external_issue'
          // Account operations
          case 'list_accounts':
            return 'pylon_list_accounts'
          case 'create_account':
            return 'pylon_create_account'
          case 'get_account':
            return 'pylon_get_account'
          case 'update_account':
            return 'pylon_update_account'
          case 'delete_account':
            return 'pylon_delete_account'
          case 'bulk_update_accounts':
            return 'pylon_bulk_update_accounts'
          case 'search_accounts':
            return 'pylon_search_accounts'
          // Contact operations
          case 'list_contacts':
            return 'pylon_list_contacts'
          case 'create_contact':
            return 'pylon_create_contact'
          case 'get_contact':
            return 'pylon_get_contact'
          case 'update_contact':
            return 'pylon_update_contact'
          case 'delete_contact':
            return 'pylon_delete_contact'
          case 'search_contacts':
            return 'pylon_search_contacts'
          // User operations
          case 'list_users':
            return 'pylon_list_users'
          case 'get_user':
            return 'pylon_get_user'
          case 'update_user':
            return 'pylon_update_user'
          case 'search_users':
            return 'pylon_search_users'
          // Team operations
          case 'list_teams':
            return 'pylon_list_teams'
          case 'get_team':
            return 'pylon_get_team'
          case 'create_team':
            return 'pylon_create_team'
          case 'update_team':
            return 'pylon_update_team'
          // Tag operations
          case 'list_tags':
            return 'pylon_list_tags'
          case 'get_tag':
            return 'pylon_get_tag'
          case 'create_tag':
            return 'pylon_create_tag'
          case 'update_tag':
            return 'pylon_update_tag'
          case 'delete_tag':
            return 'pylon_delete_tag'
          // Message operations
          case 'redact_message':
            return 'pylon_redact_message'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { apiToken, operation, ...rest } = params
        const cleanParams: Record<string, any> = { apiToken }

        // Handle parameter mapping
        if (params.accountIdField) {
          cleanParams.accountId = params.accountIdField
        }
        if (params.followerOperation) {
          cleanParams.operation = params.followerOperation
        }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            // Skip mapped fields
            if (key === 'accountIdField' || key === 'followerOperation') {
              return
            }
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiToken: { type: 'string', description: 'Pylon API token' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: { type: 'json', description: 'Operation result data' },
  },
}
