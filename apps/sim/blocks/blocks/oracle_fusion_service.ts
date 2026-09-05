import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { OracleFusionServiceResponse } from '@/tools/oracle_fusion_service/types'

function optionalInput(value: unknown): unknown {
  return value === '' || value === null ? undefined : value
}

function optionalNumber(value: unknown): unknown {
  const input = optionalInput(value)
  return typeof input === 'string' ? Number(input) : input
}

function optionalBoolean(value: unknown): unknown {
  const input = optionalInput(value)
  if (input === 'true') return true
  if (input === 'false') return false
  return input
}

export const OracleFusionServiceBlock: BlockConfig<OracleFusionServiceResponse> = {
  type: 'oracle_fusion_service',
  name: 'Oracle Fusion Service',
  description: 'Manage Fusion Service requests, routing, and support context',
  longDescription:
    'Connect a stored Oracle Fusion service account to the Sales and Fusion Service ADF REST API (crmRestApi, 11.13.18.05). Manage service requests, status transitions, queue assignment, contacts, and team memberships. Read customer accounts, contacts, agent resources, business units, messages, internal notes, and interaction references. Directory records remain read-only. This is not Oracle B2C Service and does not implement Fusion Sales workflows. Message/note writes, sending email, attachments, and knowledge endpoints are not supported.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_service',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.Support,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Service',
    sentences: {
      byOperation: {
        oracle_fusion_service_list_service_requests: ['List Service Requests'],
        oracle_fusion_service_get_service_request: [
          {
            text: 'Get Service Request',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_list_accounts: ['List Accounts'],
        oracle_fusion_service_get_account: [
          { text: 'Get Account', field: 'partyNumber', core: true },
        ],
        oracle_fusion_service_list_contacts: ['List Contacts'],
        oracle_fusion_service_get_contact: [
          { text: 'Get Contact', field: 'partyNumber', core: true },
        ],
        oracle_fusion_service_list_queues: ['List Queues'],
        oracle_fusion_service_get_queue: [
          { text: 'Get Queue', field: ['queueIdSelector', 'queueIdManual'], core: true },
        ],
        oracle_fusion_service_list_resources: ['List Resources'],
        oracle_fusion_service_get_resource: [
          { text: 'Get Resource', field: 'partyNumber', core: true },
        ],
        oracle_fusion_service_list_service_business_units: ['List Service Business Units'],
        oracle_fusion_service_get_service_business_unit: [
          {
            text: 'Get Service Business Unit',
            field: ['businessUnitIdSelector', 'businessUnitIdManual'],
            core: true,
          },
        ],
        oracle_fusion_service_list_service_request_statuses: ['List Service Request Statuses'],
        oracle_fusion_service_list_service_request_contacts: [
          {
            text: 'List Service Request Contacts',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_get_service_request_contact: [
          {
            text: 'Get Service Request Contact',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_list_service_request_resources: [
          {
            text: 'List Service Request Resources',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_get_service_request_resource: [
          {
            text: 'Get Service Request Resource',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_list_service_request_messages: [
          {
            text: 'List Service Request Messages',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_get_service_request_message: [
          {
            text: 'Get Service Request Message',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_list_service_request_interactions: [
          {
            text: 'List Service Request Interactions',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_get_service_request_interaction: [
          {
            text: 'Get Service Request Interaction',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_create_service_request: [
          { text: 'Create Service Request', field: 'title', core: true },
        ],
        oracle_fusion_service_update_service_request: [
          {
            text: 'Update Service Request',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_transition_service_request_status: [
          {
            text: 'Transition Service Request Status',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_assign_service_request: [
          {
            text: 'Assign Service Request',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_run_queue_assignment: [
          {
            text: 'Run Queue Assignment',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_add_service_request_contact: [
          {
            text: 'Add Service Request Contact',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_remove_service_request_contact: [
          {
            text: 'Remove Service Request Contact',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_add_service_request_resource: [
          {
            text: 'Add Service Request Resource',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
        oracle_fusion_service_remove_service_request_resource: [
          {
            text: 'Remove Service Request Resource',
            field: ['srNumberSelector', 'srNumberManual'],
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_service',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle Fusion credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Fusion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter stored credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Service Requests', id: 'oracle_fusion_service_list_service_requests' },
        { label: 'Get Service Request', id: 'oracle_fusion_service_get_service_request' },
        { label: 'List Accounts', id: 'oracle_fusion_service_list_accounts' },
        { label: 'Get Account', id: 'oracle_fusion_service_get_account' },
        { label: 'List Contacts', id: 'oracle_fusion_service_list_contacts' },
        { label: 'Get Contact', id: 'oracle_fusion_service_get_contact' },
        { label: 'List Queues', id: 'oracle_fusion_service_list_queues' },
        { label: 'Get Queue', id: 'oracle_fusion_service_get_queue' },
        { label: 'List Resources', id: 'oracle_fusion_service_list_resources' },
        { label: 'Get Resource', id: 'oracle_fusion_service_get_resource' },
        {
          label: 'List Service Business Units',
          id: 'oracle_fusion_service_list_service_business_units',
        },
        {
          label: 'Get Service Business Unit',
          id: 'oracle_fusion_service_get_service_business_unit',
        },
        {
          label: 'List Service Request Statuses',
          id: 'oracle_fusion_service_list_service_request_statuses',
        },
        {
          label: 'List Service Request Contacts',
          id: 'oracle_fusion_service_list_service_request_contacts',
        },
        {
          label: 'Get Service Request Contact',
          id: 'oracle_fusion_service_get_service_request_contact',
        },
        {
          label: 'List Service Request Resources',
          id: 'oracle_fusion_service_list_service_request_resources',
        },
        {
          label: 'Get Service Request Resource',
          id: 'oracle_fusion_service_get_service_request_resource',
        },
        {
          label: 'List Service Request Messages',
          id: 'oracle_fusion_service_list_service_request_messages',
        },
        {
          label: 'Get Service Request Message',
          id: 'oracle_fusion_service_get_service_request_message',
        },
        {
          label: 'List Service Request Interactions',
          id: 'oracle_fusion_service_list_service_request_interactions',
        },
        {
          label: 'Get Service Request Interaction',
          id: 'oracle_fusion_service_get_service_request_interaction',
        },
        { label: 'Create Service Request', id: 'oracle_fusion_service_create_service_request' },
        { label: 'Update Service Request', id: 'oracle_fusion_service_update_service_request' },
        {
          label: 'Transition Service Request Status',
          id: 'oracle_fusion_service_transition_service_request_status',
        },
        { label: 'Assign Service Request', id: 'oracle_fusion_service_assign_service_request' },
        { label: 'Run Queue Assignment', id: 'oracle_fusion_service_run_queue_assignment' },
        {
          label: 'Add Service Request Contact',
          id: 'oracle_fusion_service_add_service_request_contact',
        },
        {
          label: 'Remove Service Request Contact',
          id: 'oracle_fusion_service_remove_service_request_contact',
        },
        {
          label: 'Add Service Request Resource',
          id: 'oracle_fusion_service_add_service_request_resource',
        },
        {
          label: 'Remove Service Request Resource',
          id: 'oracle_fusion_service_remove_service_request_resource',
        },
      ],
      value: () => 'oracle_fusion_service_list_service_requests',
      required: true,
    },
    {
      id: 'srNumberSelector',
      title: 'Service Request',
      type: 'project-selector',
      canonicalParamId: 'srNumber',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.serviceRequests',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select service request',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_request',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_get_service_request_contact',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_get_service_request_resource',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_get_service_request_message',
          'oracle_fusion_service_list_service_request_interactions',
          'oracle_fusion_service_get_service_request_interaction',
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_transition_service_request_status',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_run_queue_assignment',
          'oracle_fusion_service_add_service_request_contact',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_add_service_request_resource',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_request',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_get_service_request_contact',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_get_service_request_resource',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_get_service_request_message',
          'oracle_fusion_service_list_service_request_interactions',
          'oracle_fusion_service_get_service_request_interaction',
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_transition_service_request_status',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_run_queue_assignment',
          'oracle_fusion_service_add_service_request_contact',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_add_service_request_resource',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
    },
    {
      id: 'srNumberManual',
      title: 'Service Request',
      type: 'short-input',
      canonicalParamId: 'srNumber',
      mode: 'advanced',
      placeholder: 'Service request number (SrNumber), not the numeric SrId.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_request',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_get_service_request_contact',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_get_service_request_resource',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_get_service_request_message',
          'oracle_fusion_service_list_service_request_interactions',
          'oracle_fusion_service_get_service_request_interaction',
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_transition_service_request_status',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_run_queue_assignment',
          'oracle_fusion_service_add_service_request_contact',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_add_service_request_resource',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_request',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_get_service_request_contact',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_get_service_request_resource',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_get_service_request_message',
          'oracle_fusion_service_list_service_request_interactions',
          'oracle_fusion_service_get_service_request_interaction',
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_transition_service_request_status',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_run_queue_assignment',
          'oracle_fusion_service_add_service_request_contact',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_add_service_request_resource',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
    },
    {
      id: 'partyNumber',
      title: 'Party Number',
      type: 'short-input',
      placeholder:
        'Directory PartyNumber, not the numeric PartyId returned by assignment selectors.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_account',
          'oracle_fusion_service_get_contact',
          'oracle_fusion_service_get_resource',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_account',
          'oracle_fusion_service_get_contact',
          'oracle_fusion_service_get_resource',
        ],
      },
    },
    {
      id: 'queueIdSelector',
      title: 'Queue',
      type: 'project-selector',
      canonicalParamId: 'queueId',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.queues',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select queue',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_queue',
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_assign_service_request',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_get_queue'],
      },
    },
    {
      id: 'queueIdManual',
      title: 'Queue',
      type: 'short-input',
      canonicalParamId: 'queueId',
      mode: 'advanced',
      placeholder: 'QueueId as an exact decimal string.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_queue',
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_assign_service_request',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_get_queue'],
      },
    },
    {
      id: 'businessUnitIdSelector',
      title: 'Service Business Unit',
      type: 'project-selector',
      canonicalParamId: 'businessUnitId',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.businessUnits',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select service business unit',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_business_unit',
          'oracle_fusion_service_create_service_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_business_unit',
          'oracle_fusion_service_create_service_request',
        ],
      },
    },
    {
      id: 'businessUnitIdManual',
      title: 'Service Business Unit',
      type: 'short-input',
      canonicalParamId: 'businessUnitId',
      mode: 'advanced',
      placeholder: 'Service business unit BUOrgId as an exact decimal string.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_business_unit',
          'oracle_fusion_service_create_service_request',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_business_unit',
          'oracle_fusion_service_create_service_request',
        ],
      },
    },
    {
      id: 'memberId',
      title: 'Member ID',
      type: 'short-input',
      placeholder: 'Service request child MemberId, not the contact or resource PartyId.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_request_contact',
          'oracle_fusion_service_get_service_request_resource',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_service_get_service_request_contact',
          'oracle_fusion_service_get_service_request_resource',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Service request MessageId as an exact decimal string.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_get_service_request_message'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_get_service_request_message'],
      },
    },
    {
      id: 'referenceId',
      title: 'Interaction Reference ID',
      type: 'short-input',
      placeholder: 'Service request interaction ReferenceId, not InteractionId.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_get_service_request_interaction'],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_get_service_request_interaction'],
      },
    },
    {
      id: 'accountPartyIdSelector',
      title: 'Account',
      type: 'project-selector',
      canonicalParamId: 'accountPartyId',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.accounts',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select account',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
        ],
      },
      required: false,
    },
    {
      id: 'accountPartyIdManual',
      title: 'Account',
      type: 'short-input',
      canonicalParamId: 'accountPartyId',
      mode: 'advanced',
      placeholder: 'Customer account PartyId as an exact decimal string.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
        ],
      },
      required: false,
    },
    {
      id: 'contactPartyIdSelector',
      title: 'Contact',
      type: 'project-selector',
      canonicalParamId: 'contactPartyId',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.contacts',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select contact',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_add_service_request_contact',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_contact'],
      },
    },
    {
      id: 'contactPartyIdManual',
      title: 'Contact',
      type: 'short-input',
      canonicalParamId: 'contactPartyId',
      mode: 'advanced',
      placeholder: 'Contact PartyId as an exact decimal string.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_add_service_request_contact',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_contact'],
      },
    },
    {
      id: 'resourcePartyIdSelector',
      title: 'Agent Resource',
      type: 'project-selector',
      canonicalParamId: 'resourcePartyId',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.resources',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select agent resource',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_add_service_request_resource',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_resource'],
      },
    },
    {
      id: 'resourcePartyIdManual',
      title: 'Agent Resource',
      type: 'short-input',
      canonicalParamId: 'resourcePartyId',
      mode: 'advanced',
      placeholder:
        'Agent resource PartyId, not ResourceProfileId. Sent as AssigneeResourceId or child ObjectId.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_add_service_request_resource',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_resource'],
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Service request title, up to 400 characters.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_create_service_request'],
      },
    },
    {
      id: 'problemDescription',
      title: 'Problem Description',
      type: 'long-input',
      placeholder: 'Problem description, up to 1000 characters.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
        ],
      },
      required: false,
    },
    {
      id: 'statusCodeSelector',
      title: 'Status',
      type: 'project-selector',
      canonicalParamId: 'statusCode',
      serviceId: 'oracle_fusion_service',
      selectorKey: 'oracleFusionService.statuses',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select status',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_transition_service_request_status',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_transition_service_request_status'],
      },
    },
    {
      id: 'statusCodeManual',
      title: 'Status',
      type: 'short-input',
      canonicalParamId: 'statusCode',
      mode: 'advanced',
      placeholder: 'Tenant service request status LookupCode. Oracle enforces valid transitions.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_transition_service_request_status',
        ],
      },
      required: {
        field: 'operation',
        value: ['oracle_fusion_service_transition_service_request_status'],
      },
    },
    {
      id: 'severityCode',
      title: 'Severity Code',
      type: 'short-input',
      placeholder: 'Tenant severity code from ORA_SVC_SR_SEVERITY_CD.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
        ],
      },
      required: false,
    },
    {
      id: 'channelTypeCode',
      title: 'Channel Type Code',
      type: 'short-input',
      placeholder: 'Tenant channel code from ORA_SVC_CHANNEL_TYPE_CD.',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_create_service_request',
          'oracle_fusion_service_update_service_request',
        ],
      },
      required: false,
    },
    {
      id: 'resolveDescription',
      title: 'Resolve Description',
      type: 'long-input',
      placeholder: 'Resolution description, up to 1000 characters.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_transition_service_request_status'],
      },
      required: false,
    },
    {
      id: 'resolveOutcomeCode',
      title: 'Resolve Outcome Code',
      type: 'short-input',
      placeholder: 'Tenant service request resolution outcome code.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_transition_service_request_status'],
      },
      required: false,
    },
    {
      id: 'resolutionCode',
      title: 'Resolution Code',
      type: 'short-input',
      placeholder: 'Tenant resolution code from ORA_SVC_SR_RESOLUTION_CD.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_transition_service_request_status'],
      },
      required: false,
    },
    {
      id: 'accessLevelCode',
      title: 'Access Level Code',
      type: 'short-input',
      placeholder: 'Service request contact access-level code.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_contact'],
      },
      required: false,
    },
    {
      id: 'relationTypeCode',
      title: 'Relation Type Code',
      type: 'short-input',
      placeholder: 'Service request contact relationship code.',
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_contact'],
      },
      required: false,
    },
    {
      id: 'primaryContact',
      title: 'Primary Contact',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_contact'],
      },
      required: false,
    },
    {
      id: 'owner',
      title: 'Owner',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_add_service_request_resource'],
      },
      required: false,
    },
    {
      id: 'overrideQueue',
      title: 'Override Queue',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['oracle_fusion_service_run_queue_assignment'],
      },
      required: false,
    },
    {
      id: 'ifMatch',
      title: 'If-Match ETag',
      type: 'short-input',
      placeholder: 'Optional Oracle ETag for conditional PATCH or DELETE (If-Match).',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_update_service_request',
          'oracle_fusion_service_transition_service_request_status',
          'oracle_fusion_service_assign_service_request',
          'oracle_fusion_service_remove_service_request_contact',
          'oracle_fusion_service_remove_service_request_resource',
        ],
      },
      required: false,
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      placeholder: 'Oracle ADF q filter using documented fields of this resource',
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          "Generate an Oracle Fusion ADF q filter for the selected resource using its documented field names. Example for service requests: StatusCd='ORA_SVC_NEW'. Do not invent tenant status codes or use Oracle B2C syntax. Return ONLY the q filter expression.",
        placeholder: 'Describe the records to filter',
      },
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_list_service_requests',
          'oracle_fusion_service_list_accounts',
          'oracle_fusion_service_list_contacts',
          'oracle_fusion_service_list_queues',
          'oracle_fusion_service_list_resources',
          'oracle_fusion_service_list_service_business_units',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_list_service_request_interactions',
        ],
      },
      required: false,
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Oracle orderBy using documented fields of this resource',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_list_service_requests',
          'oracle_fusion_service_list_accounts',
          'oracle_fusion_service_list_contacts',
          'oracle_fusion_service_list_queues',
          'oracle_fusion_service_list_resources',
          'oracle_fusion_service_list_service_business_units',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_list_service_request_interactions',
        ],
      },
      required: false,
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Page size, 1–100 (default 50).',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_list_service_requests',
          'oracle_fusion_service_list_accounts',
          'oracle_fusion_service_list_contacts',
          'oracle_fusion_service_list_queues',
          'oracle_fusion_service_list_resources',
          'oracle_fusion_service_list_service_business_units',
          'oracle_fusion_service_list_service_request_statuses',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_list_service_request_interactions',
        ],
      },
      required: false,
    },
    {
      id: 'offset',
      title: 'Page Offset',
      type: 'short-input',
      placeholder: 'Zero-based page offset (default 0).',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_list_service_requests',
          'oracle_fusion_service_list_accounts',
          'oracle_fusion_service_list_contacts',
          'oracle_fusion_service_list_queues',
          'oracle_fusion_service_list_resources',
          'oracle_fusion_service_list_service_business_units',
          'oracle_fusion_service_list_service_request_statuses',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_list_service_request_interactions',
        ],
      },
      required: false,
    },
    {
      id: 'totalResults',
      title: 'Include Total Results',
      type: 'dropdown',
      options: [
        { label: 'Not specified', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_service_list_service_requests',
          'oracle_fusion_service_list_accounts',
          'oracle_fusion_service_list_contacts',
          'oracle_fusion_service_list_queues',
          'oracle_fusion_service_list_resources',
          'oracle_fusion_service_list_service_business_units',
          'oracle_fusion_service_list_service_request_statuses',
          'oracle_fusion_service_list_service_request_contacts',
          'oracle_fusion_service_list_service_request_resources',
          'oracle_fusion_service_list_service_request_messages',
          'oracle_fusion_service_list_service_request_interactions',
        ],
      },
      required: false,
    },
  ],
  tools: {
    access: [
      'oracle_fusion_service_list_service_requests',
      'oracle_fusion_service_get_service_request',
      'oracle_fusion_service_list_accounts',
      'oracle_fusion_service_get_account',
      'oracle_fusion_service_list_contacts',
      'oracle_fusion_service_get_contact',
      'oracle_fusion_service_list_queues',
      'oracle_fusion_service_get_queue',
      'oracle_fusion_service_list_resources',
      'oracle_fusion_service_get_resource',
      'oracle_fusion_service_list_service_business_units',
      'oracle_fusion_service_get_service_business_unit',
      'oracle_fusion_service_list_service_request_statuses',
      'oracle_fusion_service_list_service_request_contacts',
      'oracle_fusion_service_get_service_request_contact',
      'oracle_fusion_service_list_service_request_resources',
      'oracle_fusion_service_get_service_request_resource',
      'oracle_fusion_service_list_service_request_messages',
      'oracle_fusion_service_get_service_request_message',
      'oracle_fusion_service_list_service_request_interactions',
      'oracle_fusion_service_get_service_request_interaction',
      'oracle_fusion_service_create_service_request',
      'oracle_fusion_service_update_service_request',
      'oracle_fusion_service_transition_service_request_status',
      'oracle_fusion_service_assign_service_request',
      'oracle_fusion_service_run_queue_assignment',
      'oracle_fusion_service_add_service_request_contact',
      'oracle_fusion_service_remove_service_request_contact',
      'oracle_fusion_service_add_service_request_resource',
      'oracle_fusion_service_remove_service_request_resource',
    ],
    config: {
      tool: (params) => params.operation || 'oracle_fusion_service_list_service_requests',
      params: (params) => ({
        oauthCredential: params.oauthCredential,
        srNumber: optionalInput(params.srNumber),
        partyNumber: optionalInput(params.partyNumber),
        queueId: optionalInput(params.queueId),
        businessUnitId: optionalInput(params.businessUnitId),
        memberId: optionalInput(params.memberId),
        messageId: optionalInput(params.messageId),
        referenceId: optionalInput(params.referenceId),
        accountPartyId: optionalInput(params.accountPartyId),
        contactPartyId: optionalInput(params.contactPartyId),
        resourcePartyId: optionalInput(params.resourcePartyId),
        title: optionalInput(params.title),
        problemDescription: params.problemDescription ?? undefined,
        statusCode: optionalInput(params.statusCode),
        severityCode: optionalInput(params.severityCode),
        channelTypeCode: optionalInput(params.channelTypeCode),
        resolveDescription: params.resolveDescription ?? undefined,
        resolveOutcomeCode: optionalInput(params.resolveOutcomeCode),
        resolutionCode: optionalInput(params.resolutionCode),
        accessLevelCode: optionalInput(params.accessLevelCode),
        relationTypeCode: optionalInput(params.relationTypeCode),
        primaryContact: optionalBoolean(params.primaryContact),
        owner: optionalBoolean(params.owner),
        overrideQueue: optionalBoolean(params.overrideQueue),
        ifMatch: optionalInput(params.ifMatch),
        q: optionalInput(params.q),
        orderBy: optionalInput(params.orderBy),
        limit: optionalNumber(params.limit),
        offset: optionalNumber(params.offset),
        totalResults: optionalBoolean(params.totalResults),
      }),
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'Stored Oracle Fusion credential' },
    srNumber: { type: 'string', description: 'Sr Number' },
    partyNumber: { type: 'string', description: 'Party Number' },
    queueId: { type: 'string', description: 'Queue Id' },
    businessUnitId: { type: 'string', description: 'Business Unit Id' },
    memberId: { type: 'string', description: 'Member ID' },
    messageId: { type: 'string', description: 'Message ID' },
    referenceId: { type: 'string', description: 'Interaction Reference ID' },
    accountPartyId: { type: 'string', description: 'Account Party Id' },
    contactPartyId: { type: 'string', description: 'Contact Party Id' },
    resourcePartyId: { type: 'string', description: 'Resource Party Id' },
    title: { type: 'string', description: 'Title' },
    problemDescription: { type: 'string', description: 'Problem Description' },
    statusCode: { type: 'string', description: 'Status Code' },
    severityCode: { type: 'string', description: 'Severity Code' },
    channelTypeCode: { type: 'string', description: 'Channel Type Code' },
    resolveDescription: { type: 'string', description: 'Resolve Description' },
    resolveOutcomeCode: { type: 'string', description: 'Resolve Outcome Code' },
    resolutionCode: { type: 'string', description: 'Resolution Code' },
    accessLevelCode: { type: 'string', description: 'Access Level Code' },
    relationTypeCode: { type: 'string', description: 'Relation Type Code' },
    primaryContact: { type: 'boolean', description: 'Primary Contact' },
    owner: { type: 'boolean', description: 'Owner' },
    overrideQueue: { type: 'boolean', description: 'Override Queue' },
    ifMatch: { type: 'string', description: 'If-Match ETag' },
    q: { type: 'string', description: 'Filter' },
    orderBy: { type: 'string', description: 'Order By' },
    limit: { type: 'number', description: 'Page Size' },
    offset: { type: 'number', description: 'Page Offset' },
    totalResults: { type: 'boolean', description: 'Include Total Results' },
  },
  outputs: {
    item: {
      type: 'json',
      description:
        'Selected record: request SrNumber, Title and StatusCd; directory PartyNumber/PartyId and names; or membership/message/interaction identifiers and documented details',
    },
    items: {
      type: 'json',
      description:
        'Page of records with request SrNumber/Title/StatusCd, directory IDs/names, status LookupCode/Meaning, or child MemberId/MessageId/ReferenceId and documented details',
    },
    count: { type: 'number', description: 'Records in this page' },
    hasMore: { type: 'boolean', description: 'Whether another page exists' },
    limit: { type: 'number', description: 'Page limit' },
    offset: { type: 'number', description: 'Page offset' },
    totalResults: { type: 'number', description: 'Estimated matching records when requested' },
    nextOffset: { type: 'number', description: 'Next offset; absent on the final page' },
    result: { type: 'string', description: 'Oracle automatic assignment result' },
    deleted: { type: 'boolean', description: 'Membership removed successfully' },
  },
}

export const OracleFusionServiceBlockMeta = {
  tags: ['customer-support', 'ticketing', 'automation'],
  url: 'https://www.oracle.com/cx/service/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Triage the support backlog',
      prompt:
        'Build a scheduled workflow that reads a bounded page of Fusion Service requests using a tenant-approved status filter, includes queue and severity, and writes a triage digest to a table.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create a customer service request',
      prompt:
        'Build a workflow that finds a service business unit, account, and primary contact, obtains approval, then creates a Fusion Service request with the confirmed title and problem description.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Route a service request',
      prompt:
        'Build a workflow that reads a Fusion Service request, discovers queues and agent resources, asks for assignment approval, and assigns the request to the selected queue or resource.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Prepare a support handoff',
      prompt:
        'Build a workflow that reads request contacts and team members, identifies a confirmed new agent, and adds that agent to the service request team after approval.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review messages and internal notes',
      prompt:
        'Build a workflow that reads messages for a Fusion Service request and prepares a support-history summary while keeping internal notes separate from customer-visible messages.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Review interaction history',
      prompt:
        'Build a workflow that reads the interaction references attached to a Fusion Service request and prepares a timeline of channels, owners, and outcomes.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Resolve a service request',
      prompt:
        'Build a workflow that reads a Fusion Service request, discovers enabled tenant statuses, prepares resolution details, and transitions the request only after approval.',
      modules: ['workflows'],
      category: 'support',
      tags: ['customer-support', 'automation'],
    },
  ],
  skills: [
    {
      name: 'triage-fusion-service-backlog',
      description: 'Triage the support backlog using Oracle Fusion Service.',
      content:
        '# Triage the support backlog\n\n## Steps\n\nList Service Requests with a tenant-approved q expression and stable orderBy. Read one page at a time using nextOffset only when hasMore is true. Report request number, title, queue, and severity. Do not change requests during triage.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-get.html',
    },
    {
      name: 'create-fusion-service-request',
      description: 'Create a customer service request using Oracle Fusion Service.',
      content:
        '# Create a customer service request\n\n## Steps\n\nLook up a service business unit and customer context. Use BUOrgId and exact decimal PartyId values, not PartyNumber. Confirm the title and requested change, then Create Service Request. Return the resulting SrNumber. Do not create customer-master records.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-post.html',
    },
    {
      name: 'route-fusion-service-request',
      description: 'Route a service request using Oracle Fusion Service.',
      content:
        "# Route a service request\n\n## Steps\n\nRead the request and identify the intended queue and resource. Use QueueId and the resource PartyId, never ResourceProfileId. After approval, Assign Service Request or Run Queue Assignment as requested. For automatic assignment, report Oracle's result string without claiming an undocumented outcome.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-action-runqueueassignment-post.html",
    },
    {
      name: 'prepare-fusion-service-handoff',
      description: 'Prepare a support handoff using Oracle Fusion Service.',
      content:
        '# Prepare a support handoff\n\n## Steps\n\nRead the service request, its contacts, and resource members. Prepare a concise handoff with membership IDs. With approval, add an existing agent using its PartyId. Remove a member only by the child MemberId. These actions change membership, not the agent directory.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-srnumber-child-resourcemembers-post.html',
    },
    {
      name: 'review-fusion-service-messages',
      description: 'Review messages and internal notes using Oracle Fusion Service.',
      content:
        '# Review messages and internal notes\n\n## Steps\n\nList Service Request Messages, then Get Service Request Message for selected MessageId values. Use MessageTypeCd and VisibilityCd to preserve internal/customer distinctions. Treat content as returned by Oracle; do not guess an encoding or publish internal content. Message and note creation are not supported.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-srnumber-child-messages-get.html',
    },
    {
      name: 'review-fusion-service-interactions',
      description: 'Review interaction history using Oracle Fusion Service.',
      content:
        '# Review interaction history\n\n## Steps\n\nList Service Request Interactions and select references by ReferenceId, not InteractionId. Read the chosen reference and report its channel, direction, timestamps, and owner when present. Do not claim to retrieve a recording, full transcript, or attachments.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-srnumber-child-srinteractionreferences-get.html',
    },
    {
      name: 'resolve-fusion-service-request',
      description: 'Resolve a service request using Oracle Fusion Service.',
      content:
        '# Resolve a service request\n\n## Steps\n\nRead the service request and List Service Request Statuses. Ask for approval of the intended tenant LookupCode and resolution details. Transition Service Request Status; Oracle validates permissions and transition rules. Report the returned status and do not claim that every enabled status is valid from every current state.\n\n## Source\n\nhttps://docs.oracle.com/en/cloud/saas/sales/faaps/op-servicerequests-srnumber-patch.html',
    },
  ],
} as const satisfies BlockMeta
