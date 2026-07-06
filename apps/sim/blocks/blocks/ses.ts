import { SESIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'

export const SESBlock: BlockConfig<ToolResponse> = {
  type: 'ses',
  name: 'AWS SES',
  description: 'Send emails and manage templates with AWS Simple Email Service',
  longDescription:
    'Integrate AWS SES v2 into the workflow. Send simple, templated, and bulk emails. Manage email templates, identities, configuration sets, and the account suppression list, and retrieve account sending quota and verified identity information.',
  docsLink: 'https://docs.sim.ai/integrations/ses',
  category: 'tools',
  integrationType: IntegrationType.Email,
  authMode: AuthMode.ApiKey,
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: SESIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_email' },
        { label: 'Send Templated Email', id: 'send_templated_email' },
        { label: 'Send Bulk Email', id: 'send_bulk_email' },
        { label: 'List Identities', id: 'list_identities' },
        { label: 'Get Account', id: 'get_account' },
        { label: 'Create Template', id: 'create_template' },
        { label: 'Get Template', id: 'get_template' },
        { label: 'List Templates', id: 'list_templates' },
        { label: 'Delete Template', id: 'delete_template' },
        { label: 'Update Template', id: 'update_template' },
        { label: 'Send Custom Verification Email', id: 'send_custom_verification_email' },
        { label: 'Create Email Identity', id: 'create_email_identity' },
        { label: 'Get Email Identity', id: 'get_email_identity' },
        { label: 'Delete Email Identity', id: 'delete_email_identity' },
        { label: 'Put Suppressed Destination', id: 'put_suppressed_destination' },
        { label: 'Get Suppressed Destination', id: 'get_suppressed_destination' },
        { label: 'List Suppressed Destinations', id: 'list_suppressed_destinations' },
        { label: 'Delete Suppressed Destination', id: 'delete_suppressed_destination' },
        { label: 'Create Configuration Set', id: 'create_configuration_set' },
      ],
      value: () => 'send_email',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'fromAddress',
      title: 'From Address',
      type: 'short-input',
      placeholder: 'sender@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email', 'send_bulk_email'],
      },
      required: {
        field: 'operation',
        value: ['send_email', 'send_templated_email', 'send_bulk_email'],
      },
    },
    {
      id: 'toAddresses',
      title: 'To Addresses',
      type: 'short-input',
      placeholder: 'recipient@example.com, other@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      required: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of recipient email addresses. Return ONLY the comma-separated addresses - no explanations, no extra text.',
        placeholder: 'e.g. alice@example.com, bob@example.com',
      },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Your email subject',
      condition: { field: 'operation', value: 'send_email' },
      required: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'bodyHtml',
      title: 'HTML Body',
      type: 'long-input',
      placeholder: '<h1>Hello</h1><p>Your email content here</p>',
      condition: { field: 'operation', value: 'send_email' },
      required: false,
    },
    {
      id: 'bodyText',
      title: 'Plain Text Body',
      type: 'long-input',
      placeholder: 'Plain text version of your email',
      condition: { field: 'operation', value: 'send_email' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'templateName',
      title: 'Template Name',
      type: 'short-input',
      placeholder: 'my-email-template',
      condition: {
        field: 'operation',
        value: [
          'send_templated_email',
          'send_bulk_email',
          'get_template',
          'create_template',
          'delete_template',
          'update_template',
          'send_custom_verification_email',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'send_templated_email',
          'send_bulk_email',
          'get_template',
          'create_template',
          'delete_template',
          'update_template',
          'send_custom_verification_email',
        ],
      },
    },
    {
      id: 'templateData',
      title: 'Template Data (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"name": "John", "link": "https://example.com"}',
      condition: { field: 'operation', value: 'send_templated_email' },
      required: { field: 'operation', value: 'send_templated_email' },
    },
    {
      id: 'destinations',
      title: 'Destinations (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"toAddresses": ["user1@example.com"], "templateData": "{\"name\": \"User 1\"}"}, {"toAddresses": ["user2@example.com"]}]',
      condition: { field: 'operation', value: 'send_bulk_email' },
      required: { field: 'operation', value: 'send_bulk_email' },
    },
    {
      id: 'subjectPart',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Hello, {{name}}!',
      condition: { field: 'operation', value: ['create_template', 'update_template'] },
      required: { field: 'operation', value: ['create_template', 'update_template'] },
    },
    {
      id: 'htmlPart',
      title: 'HTML Body',
      type: 'long-input',
      placeholder: '<h1>Hello, {{name}}!</h1>',
      condition: { field: 'operation', value: ['create_template', 'update_template'] },
      required: false,
    },
    {
      id: 'textPart',
      title: 'Plain Text Body',
      type: 'long-input',
      placeholder: 'Hello, {{name}}!',
      condition: { field: 'operation', value: ['create_template', 'update_template'] },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'ccAddresses',
      title: 'CC Addresses',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'bccAddresses',
      title: 'BCC Addresses',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'replyToAddresses',
      title: 'Reply-To Addresses',
      type: 'short-input',
      placeholder: 'replyto@example.com',
      condition: { field: 'operation', value: 'send_email' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'defaultTemplateData',
      title: 'Default Template Data (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '{"company": "Acme"}',
      condition: { field: 'operation', value: 'send_bulk_email' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'configurationSetName',
      title: 'Configuration Set',
      type: 'short-input',
      placeholder: 'my-configuration-set',
      condition: {
        field: 'operation',
        value: [
          'send_email',
          'send_templated_email',
          'send_bulk_email',
          'send_custom_verification_email',
          'create_email_identity',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['list_identities', 'list_templates', 'list_suppressed_destinations'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token from previous response',
      condition: {
        field: 'operation',
        value: ['list_identities', 'list_templates', 'list_suppressed_destinations'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: {
        field: 'operation',
        value: [
          'put_suppressed_destination',
          'get_suppressed_destination',
          'delete_suppressed_destination',
          'send_custom_verification_email',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'put_suppressed_destination',
          'get_suppressed_destination',
          'delete_suppressed_destination',
          'send_custom_verification_email',
        ],
      },
    },
    {
      id: 'reason',
      title: 'Suppression Reason',
      type: 'dropdown',
      options: [
        { label: 'Bounce', id: 'BOUNCE' },
        { label: 'Complaint', id: 'COMPLAINT' },
      ],
      condition: { field: 'operation', value: 'put_suppressed_destination' },
      required: { field: 'operation', value: 'put_suppressed_destination' },
      value: () => 'BOUNCE',
    },
    {
      id: 'reasons',
      title: 'Reasons Filter',
      type: 'short-input',
      placeholder: 'BOUNCE, COMPLAINT',
      condition: { field: 'operation', value: 'list_suppressed_destinations' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: 'list_suppressed_destinations' },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp based on the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: 'list_suppressed_destinations' },
      required: false,
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate an ISO 8601 timestamp based on the user description. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'emailIdentity',
      title: 'Email Identity',
      type: 'short-input',
      placeholder: 'example.com or sender@example.com',
      condition: {
        field: 'operation',
        value: ['create_email_identity', 'get_email_identity', 'delete_email_identity'],
      },
      required: {
        field: 'operation',
        value: ['create_email_identity', 'get_email_identity', 'delete_email_identity'],
      },
    },
    {
      id: 'dkimSigningAttributes',
      title: 'DKIM Signing Attributes (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{"domainSigningSelector": "selector1", "domainSigningPrivateKey": "base64-key"}',
      condition: { field: 'operation', value: 'create_email_identity' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"key": "team", "value": "growth"}]',
      condition: {
        field: 'operation',
        value: ['create_email_identity', 'create_configuration_set'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'newConfigurationSetName',
      title: 'Configuration Set Name',
      type: 'short-input',
      placeholder: 'my-configuration-set',
      condition: { field: 'operation', value: 'create_configuration_set' },
      required: { field: 'operation', value: 'create_configuration_set' },
    },
    {
      id: 'customRedirectDomain',
      title: 'Custom Redirect Domain',
      type: 'short-input',
      placeholder: 'links.example.com',
      condition: { field: 'operation', value: 'create_configuration_set' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'httpsPolicy',
      title: 'HTTPS Policy',
      type: 'dropdown',
      options: [
        { label: 'Require', id: 'REQUIRE' },
        { label: 'Require Open Only', id: 'REQUIRE_OPEN_ONLY' },
        { label: 'Optional', id: 'OPTIONAL' },
      ],
      condition: { field: 'operation', value: 'create_configuration_set' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'tlsPolicy',
      title: 'TLS Policy',
      type: 'dropdown',
      options: [
        { label: 'Require', id: 'REQUIRE' },
        { label: 'Optional', id: 'OPTIONAL' },
      ],
      condition: { field: 'operation', value: 'create_configuration_set' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'sendingPoolName',
      title: 'Dedicated IP Pool',
      type: 'short-input',
      placeholder: 'my-ip-pool',
      condition: { field: 'operation', value: 'create_configuration_set' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'reputationMetricsEnabled',
      title: 'Enable Reputation Metrics',
      type: 'switch',
      condition: { field: 'operation', value: 'create_configuration_set' },
      mode: 'advanced',
    },
    {
      id: 'sendingEnabled',
      title: 'Enable Sending',
      type: 'switch',
      condition: { field: 'operation', value: 'create_configuration_set' },
      mode: 'advanced',
    },
    {
      id: 'suppressedReasons',
      title: 'Auto-Suppress Reasons',
      type: 'short-input',
      placeholder: 'BOUNCE, COMPLAINT',
      condition: { field: 'operation', value: 'create_configuration_set' },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'ses_send_email',
      'ses_send_templated_email',
      'ses_send_bulk_email',
      'ses_list_identities',
      'ses_get_account',
      'ses_create_template',
      'ses_get_template',
      'ses_list_templates',
      'ses_delete_template',
      'ses_update_template',
      'ses_put_suppressed_destination',
      'ses_delete_suppressed_destination',
      'ses_get_suppressed_destination',
      'ses_list_suppressed_destinations',
      'ses_create_email_identity',
      'ses_delete_email_identity',
      'ses_get_email_identity',
      'ses_create_configuration_set',
      'ses_send_custom_verification_email',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_email':
            return 'ses_send_email'
          case 'send_templated_email':
            return 'ses_send_templated_email'
          case 'send_bulk_email':
            return 'ses_send_bulk_email'
          case 'list_identities':
            return 'ses_list_identities'
          case 'get_account':
            return 'ses_get_account'
          case 'create_template':
            return 'ses_create_template'
          case 'get_template':
            return 'ses_get_template'
          case 'list_templates':
            return 'ses_list_templates'
          case 'delete_template':
            return 'ses_delete_template'
          case 'update_template':
            return 'ses_update_template'
          case 'put_suppressed_destination':
            return 'ses_put_suppressed_destination'
          case 'delete_suppressed_destination':
            return 'ses_delete_suppressed_destination'
          case 'get_suppressed_destination':
            return 'ses_get_suppressed_destination'
          case 'list_suppressed_destinations':
            return 'ses_list_suppressed_destinations'
          case 'create_email_identity':
            return 'ses_create_email_identity'
          case 'delete_email_identity':
            return 'ses_delete_email_identity'
          case 'get_email_identity':
            return 'ses_get_email_identity'
          case 'create_configuration_set':
            return 'ses_create_configuration_set'
          case 'send_custom_verification_email':
            return 'ses_send_custom_verification_email'
          default:
            throw new Error(`Invalid SES operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation, pageSize, ...rest } = params

        const connectionConfig = {
          region: rest.region,
          accessKeyId: rest.accessKeyId,
          secretAccessKey: rest.secretAccessKey,
        }

        const result: Record<string, unknown> = { ...connectionConfig }

        switch (operation) {
          case 'update_template':
            result.templateName = rest.templateName
            result.subjectPart = rest.subjectPart
            if (rest.htmlPart) result.htmlPart = rest.htmlPart
            if (rest.textPart) result.textPart = rest.textPart
            break
          case 'put_suppressed_destination':
            result.emailAddress = rest.emailAddress
            result.reason = rest.reason
            break
          case 'delete_suppressed_destination':
          case 'get_suppressed_destination':
            result.emailAddress = rest.emailAddress
            break
          case 'list_suppressed_destinations':
            if (rest.reasons) result.reasons = rest.reasons
            if (rest.startDate) result.startDate = rest.startDate
            if (rest.endDate) result.endDate = rest.endDate
            if (pageSize != null) {
              const parsed = Number.parseInt(String(pageSize), 10)
              if (!Number.isNaN(parsed)) result.pageSize = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'create_email_identity':
            result.emailIdentity = rest.emailIdentity
            if (rest.dkimSigningAttributes)
              result.dkimSigningAttributes = rest.dkimSigningAttributes
            if (rest.tags) result.tags = rest.tags
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'delete_email_identity':
          case 'get_email_identity':
            result.emailIdentity = rest.emailIdentity
            break
          case 'create_configuration_set':
            result.configurationSetName = rest.newConfigurationSetName
            if (rest.customRedirectDomain) result.customRedirectDomain = rest.customRedirectDomain
            if (rest.httpsPolicy) result.httpsPolicy = rest.httpsPolicy
            if (rest.tlsPolicy) result.tlsPolicy = rest.tlsPolicy
            if (rest.sendingPoolName) result.sendingPoolName = rest.sendingPoolName
            if (rest.reputationMetricsEnabled != null)
              result.reputationMetricsEnabled = Boolean(rest.reputationMetricsEnabled)
            if (rest.sendingEnabled != null) result.sendingEnabled = Boolean(rest.sendingEnabled)
            if (rest.suppressedReasons) result.suppressedReasons = rest.suppressedReasons
            if (rest.tags) result.tags = rest.tags
            break
          case 'send_custom_verification_email':
            result.emailAddress = rest.emailAddress
            result.templateName = rest.templateName
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'send_email':
            result.fromAddress = rest.fromAddress
            result.toAddresses = rest.toAddresses
            result.subject = rest.subject
            if (rest.bodyHtml) result.bodyHtml = rest.bodyHtml
            if (rest.bodyText) result.bodyText = rest.bodyText
            if (rest.ccAddresses) result.ccAddresses = rest.ccAddresses
            if (rest.bccAddresses) result.bccAddresses = rest.bccAddresses
            if (rest.replyToAddresses) result.replyToAddresses = rest.replyToAddresses
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'send_templated_email':
            result.fromAddress = rest.fromAddress
            result.toAddresses = rest.toAddresses
            result.templateName = rest.templateName
            result.templateData = rest.templateData
            if (rest.ccAddresses) result.ccAddresses = rest.ccAddresses
            if (rest.bccAddresses) result.bccAddresses = rest.bccAddresses
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'send_bulk_email':
            result.fromAddress = rest.fromAddress
            result.templateName = rest.templateName
            result.destinations = rest.destinations
            if (rest.defaultTemplateData) result.defaultTemplateData = rest.defaultTemplateData
            if (rest.configurationSetName) result.configurationSetName = rest.configurationSetName
            break
          case 'list_identities':
            if (pageSize != null) {
              const parsed = Number.parseInt(String(pageSize), 10)
              if (!Number.isNaN(parsed)) result.pageSize = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'get_account':
            break
          case 'create_template':
            result.templateName = rest.templateName
            result.subjectPart = rest.subjectPart
            if (rest.htmlPart) result.htmlPart = rest.htmlPart
            if (rest.textPart) result.textPart = rest.textPart
            break
          case 'get_template':
            result.templateName = rest.templateName
            break
          case 'list_templates':
            if (pageSize != null) {
              const parsed = Number.parseInt(String(pageSize), 10)
              if (!Number.isNaN(parsed)) result.pageSize = parsed
            }
            if (rest.nextToken) result.nextToken = rest.nextToken
            break
          case 'delete_template':
            result.templateName = rest.templateName
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'SES operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    fromAddress: { type: 'string', description: 'Verified sender email address' },
    toAddresses: {
      type: 'string',
      description: 'Comma-separated list of recipient email addresses',
    },
    subject: { type: 'string', description: 'Email subject line' },
    bodyHtml: { type: 'string', description: 'HTML email body' },
    bodyText: { type: 'string', description: 'Plain text email body' },
    templateName: { type: 'string', description: 'SES template name' },
    templateData: { type: 'string', description: 'JSON template variable data' },
    destinations: {
      type: 'string',
      description: 'JSON array of bulk email destinations',
    },
    subjectPart: { type: 'string', description: 'Template subject line' },
    htmlPart: { type: 'string', description: 'HTML body of the template' },
    textPart: { type: 'string', description: 'Plain text body of the template' },
    ccAddresses: { type: 'string', description: 'Comma-separated CC email addresses' },
    bccAddresses: { type: 'string', description: 'Comma-separated BCC email addresses' },
    replyToAddresses: { type: 'string', description: 'Comma-separated reply-to addresses' },
    defaultTemplateData: {
      type: 'string',
      description: 'Default JSON template data for bulk sends',
    },
    configurationSetName: { type: 'string', description: 'SES configuration set name' },
    pageSize: { type: 'number', description: 'Maximum number of results to return' },
    nextToken: { type: 'string', description: 'Pagination token from previous response' },
    emailAddress: {
      type: 'string',
      description: 'Email address for suppression or verification operations',
    },
    reason: { type: 'string', description: 'Suppression reason: BOUNCE or COMPLAINT' },
    reasons: { type: 'string', description: 'Comma-separated suppression reasons filter' },
    startDate: { type: 'string', description: 'Suppression list filter start date (ISO 8601)' },
    endDate: { type: 'string', description: 'Suppression list filter end date (ISO 8601)' },
    emailIdentity: { type: 'string', description: 'Email address or domain identity' },
    dkimSigningAttributes: { type: 'json', description: 'JSON BYODKIM signing attributes' },
    tags: { type: 'json', description: 'JSON array of key/value tags' },
    newConfigurationSetName: { type: 'string', description: 'Name for a new configuration set' },
    customRedirectDomain: { type: 'string', description: 'Custom domain for open/click tracking' },
    httpsPolicy: { type: 'string', description: 'HTTPS policy for tracking links' },
    tlsPolicy: { type: 'string', description: 'TLS policy for delivery' },
    sendingPoolName: { type: 'string', description: 'Dedicated IP pool name' },
    reputationMetricsEnabled: {
      type: 'boolean',
      description: 'Whether to collect reputation metrics',
    },
    sendingEnabled: { type: 'boolean', description: 'Whether sending is enabled' },
    suppressedReasons: { type: 'string', description: 'Comma-separated auto-suppression reasons' },
  },
  outputs: {
    messageId: {
      type: 'string',
      description:
        'SES message ID (send_email, send_templated_email, send_custom_verification_email)',
      condition: {
        field: 'operation',
        value: ['send_email', 'send_templated_email', 'send_custom_verification_email'],
      },
    },
    results: {
      type: 'array',
      description: 'Per-destination send results (send_bulk_email)',
      condition: { field: 'operation', value: 'send_bulk_email' },
    },
    successCount: {
      type: 'number',
      description: 'Number of successfully sent emails (send_bulk_email)',
      condition: { field: 'operation', value: 'send_bulk_email' },
    },
    failureCount: {
      type: 'number',
      description: 'Number of failed email sends (send_bulk_email)',
      condition: { field: 'operation', value: 'send_bulk_email' },
    },
    identities: {
      type: 'array',
      description: 'List of verified email identities (list_identities)',
      condition: { field: 'operation', value: 'list_identities' },
    },
    nextToken: {
      type: 'string',
      description:
        'Pagination token for the next page (list_identities, list_templates, list_suppressed_destinations)',
      condition: {
        field: 'operation',
        value: ['list_identities', 'list_templates', 'list_suppressed_destinations'],
      },
    },
    count: {
      type: 'number',
      description:
        'Number of items returned (list_identities, list_templates, list_suppressed_destinations)',
      condition: {
        field: 'operation',
        value: ['list_identities', 'list_templates', 'list_suppressed_destinations'],
      },
    },
    destinations: {
      type: 'array',
      description: 'List of suppressed destinations (list_suppressed_destinations)',
      condition: { field: 'operation', value: 'list_suppressed_destinations' },
    },
    emailAddress: {
      type: 'string',
      description: 'The suppressed email address (get_suppressed_destination)',
      condition: { field: 'operation', value: 'get_suppressed_destination' },
    },
    reason: {
      type: 'string',
      description: 'The suppression reason (get_suppressed_destination)',
      condition: { field: 'operation', value: 'get_suppressed_destination' },
    },
    lastUpdateTime: {
      type: 'string',
      description:
        'When the address was added to the suppression list (get_suppressed_destination)',
      condition: { field: 'operation', value: 'get_suppressed_destination' },
    },
    feedbackId: {
      type: 'string',
      description: 'Feedback ID for the bounce/complaint event (get_suppressed_destination)',
      condition: { field: 'operation', value: 'get_suppressed_destination' },
    },
    identityType: {
      type: 'string',
      description:
        'Identity type: EMAIL_ADDRESS or DOMAIN (create_email_identity, get_email_identity)',
      condition: { field: 'operation', value: ['create_email_identity', 'get_email_identity'] },
    },
    verifiedForSendingStatus: {
      type: 'boolean',
      description:
        'Whether the identity is verified for sending (create_email_identity, get_email_identity)',
      condition: { field: 'operation', value: ['create_email_identity', 'get_email_identity'] },
    },
    dkimAttributes: {
      type: 'json',
      description: 'DKIM signing status and tokens (create_email_identity, get_email_identity)',
      condition: { field: 'operation', value: ['create_email_identity', 'get_email_identity'] },
    },
    verificationStatus: {
      type: 'string',
      description: 'Identity verification status (get_email_identity)',
      condition: { field: 'operation', value: 'get_email_identity' },
    },
    feedbackForwardingStatus: {
      type: 'boolean',
      description: 'Whether bounce/complaint feedback is forwarded by email (get_email_identity)',
      condition: { field: 'operation', value: 'get_email_identity' },
    },
    mailFromAttributes: {
      type: 'json',
      description: 'Custom MAIL FROM domain configuration (get_email_identity)',
      condition: { field: 'operation', value: 'get_email_identity' },
    },
    policies: {
      type: 'json',
      description: 'Sending authorization policies (get_email_identity)',
      condition: { field: 'operation', value: 'get_email_identity' },
    },
    verificationInfo: {
      type: 'json',
      description: 'Additional verification diagnostics (get_email_identity)',
      condition: { field: 'operation', value: 'get_email_identity' },
    },
    sendingEnabled: {
      type: 'boolean',
      description: 'Whether email sending is enabled (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    max24HourSend: {
      type: 'number',
      description: 'Maximum emails per 24 hours (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    maxSendRate: {
      type: 'number',
      description: 'Maximum emails per second (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    sentLast24Hours: {
      type: 'number',
      description: 'Emails sent in the last 24 hours (get_account)',
      condition: { field: 'operation', value: 'get_account' },
    },
    templateName: {
      type: 'string',
      description: 'Template name (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    subjectPart: {
      type: 'string',
      description: 'Template subject (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    textPart: {
      type: 'string',
      description: 'Template plain text body (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    htmlPart: {
      type: 'string',
      description: 'Template HTML body (get_template)',
      condition: { field: 'operation', value: 'get_template' },
    },
    templates: {
      type: 'array',
      description: 'List of email templates (list_templates)',
      condition: { field: 'operation', value: 'list_templates' },
    },
    tags: {
      type: 'array',
      description: 'Tags associated with the identity (get_email_identity)',
      condition: { field: 'operation', value: 'get_email_identity' },
    },
    message: {
      type: 'string',
      description:
        'Confirmation message (create_template, delete_template, update_template, put_suppressed_destination, delete_suppressed_destination, delete_email_identity, create_configuration_set)',
      condition: {
        field: 'operation',
        value: [
          'create_template',
          'delete_template',
          'update_template',
          'put_suppressed_destination',
          'delete_suppressed_destination',
          'delete_email_identity',
          'create_configuration_set',
        ],
      },
    },
  },
}

export const SESBlockMeta = {
  tags: ['cloud', 'email-marketing', 'messaging'],
  url: 'https://aws.amazon.com/ses',
  templates: [
    {
      icon: SESIcon,
      title: 'SES bulk announcement',
      prompt:
        'Create a workflow that takes a recipient list from a table and an SES email template, sends the announcement using SES bulk send with per-recipient template data, and writes the per-recipient send status back to the table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: SESIcon,
      title: 'SES verified-identity audit',
      prompt:
        'Build a scheduled workflow that lists AWS SES verified identities, checks the account sending quota and reputation, and posts a Slack report when any identity is unverified or the account approaches the daily quota.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SESIcon,
      title: 'SES templated nurture',
      prompt:
        'Create a workflow that walks each contact in a tables-based nurture sequence through staged SES templated sends with delays between steps, branches on open or click, and stops the sequence when the contact replies.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: SESIcon,
      title: 'SES + Mailgun multi-region sender',
      prompt:
        'Build a workflow that routes transactional emails through SES in primary regions and through Mailgun for regions where SES is not provisioned, normalizing template variables and writing one unified send log to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'infrastructure', 'automation'],
      alsoIntegrations: ['mailgun'],
    },
    {
      icon: SESIcon,
      title: 'SES + AgentMail customer concierge',
      prompt:
        'Create a workflow that sends outbound customer messages through AWS SES but provisions a per-customer AgentMail inbox to receive replies, threads conversations across both, and tags AgentMail threads with the customer ID.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['agentmail'],
    },
    {
      icon: SESIcon,
      title: 'SES suppression list sync',
      prompt:
        'Build a workflow that reads bounce and complaint webhook events, adds the affected addresses to the SES account suppression list with the matching reason, and periodically lists suppressed destinations to reconcile a marketing contacts table so unreachable addresses are excluded from future sends.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'analysis'],
    },
    {
      icon: SESIcon,
      title: 'SES new-domain onboarding',
      prompt:
        'Create a workflow that takes a new sending domain from a table, creates the SES email identity, polls get email identity until DKIM verification succeeds, creates a dedicated configuration set with open and click tracking enabled, and posts the DNS tokens to Slack for the infrastructure team to add.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'infrastructure', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SESIcon,
      title: 'SES domain reputation monitor',
      prompt:
        'Build a scheduled daily workflow that pulls SES account sending statistics and per-identity reputation indicators, logs them to a tracking table for trend lines, and flags any identity whose complaint or bounce rate is trending up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring', 'analysis'],
    },
    {
      icon: SESIcon,
      title: 'SES template library sync',
      prompt:
        'Build a workflow that reads my approved email templates from a table, creates or updates each one in AWS SES with create template, lists existing SES templates to detect drift, and deletes templates that have been removed from the table so the SES library stays in sync.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['marketing', 'automation', 'content'],
    },
  ],
  skills: [
    {
      name: 'send-notification-email',
      description:
        'Send a transactional email through AWS SES to one or more recipients. Use for alerts, confirmations, and one-off notifications from a workflow.',
      content:
        '# Send Notification Email\n\nSend a transactional email via SES.\n\n## Steps\n1. Determine the verified sender identity, the recipients, subject, and body.\n2. Choose a plain-text or HTML body to match the message.\n3. Send the email, including reply-to or CC recipients if needed.\n4. Confirm the send succeeded and capture the message ID.\n\n## Output\nReport the SES message ID and the recipients. If the send was rejected, surface the SES error (for example, an unverified sender or sandbox restriction).',
    },
    {
      name: 'send-templated-campaign',
      description:
        'Send a templated SES email to many recipients with per-recipient personalization. Use for newsletters, onboarding sequences, and bulk notifications.',
      content:
        "# Send Templated Campaign\n\nSend personalized emails using an SES template.\n\n## Steps\n1. Confirm the template exists with get template, or create it first.\n2. Assemble the recipient list with each recipient's template data for personalization.\n3. Use send bulk email for many recipients, or send templated email for a single message.\n4. Collect per-recipient send status.\n\n## Output\nReport how many messages were accepted versus failed, with message IDs and the reason for any failures.",
    },
    {
      name: 'manage-email-templates',
      description:
        'Create, fetch, list, update, and delete reusable email templates in AWS SES. Use to maintain a consistent, version-controlled template library.',
      content:
        '# Manage Email Templates\n\nMaintain the SES template library.\n\n## Steps\n1. To add a template, create it with a name, subject, and HTML and text parts using placeholder variables.\n2. To review, get a template by name or list templates.\n3. To revise copy without changing the name, update the template with new subject, HTML, or text content.\n4. To retire one, delete the template by name.\n5. Keep template names descriptive so they are easy to reference when sending.\n\n## Output\nReport the template name affected and the action taken, or the template contents for a fetch.',
    },
    {
      name: 'manage-suppression-list',
      description:
        'Add, remove, look up, and list addresses on the AWS SES account-level suppression list. Use to keep bounced or complained addresses out of future sends.',
      content:
        '# Manage Suppression List\n\nKeep the SES suppression list accurate so future sends skip unreachable or unwilling recipients.\n\n## Steps\n1. To suppress an address after a bounce or complaint, put a suppressed destination with the matching reason (BOUNCE or COMPLAINT).\n2. To check whether an address is already suppressed, get the suppressed destination by email address.\n3. To audit the list, list suppressed destinations, optionally filtered by reason or a date range.\n4. To re-enable sending to an address (for example, after a customer confirms a new inbox), delete the suppressed destination.\n\n## Output\nReport the email address affected and the action taken. For a list, report the count of suppressed addresses and their reasons.',
    },
    {
      name: 'onboard-sending-domain',
      description:
        'Verify a new sending domain or address in AWS SES and check DKIM and verification status. Use before sending from a new identity.',
      content:
        '# Onboard Sending Domain\n\nVerify a new SES identity before sending from it.\n\n## Steps\n1. Create the email identity for the domain or address you want to send from.\n2. If DKIM tokens are returned, hand them to whoever manages DNS to add as CNAME records.\n3. Get the email identity periodically to check verification status and DKIM signing status until it reports success.\n4. Once verified, optionally create a configuration set to control tracking, delivery, and reputation options for emails sent from the identity.\n5. If the identity is no longer needed, delete the email identity.\n\n## Output\nReport the identity, its verification status, and DKIM status. If verification is pending, report the DNS records that still need to be added.',
    },
    {
      name: 'check-sending-health',
      description:
        'Inspect AWS SES account sending limits, quota usage, and verified identities. Use to confirm capacity and deliverability readiness before a send.',
      content:
        '# Check Sending Health\n\nVerify SES is ready to send.\n\n## Steps\n1. Get the account to read the sending quota, send rate, and whether the account is out of the sandbox.\n2. List identities to confirm the intended sender domain or address is verified.\n3. Compare planned volume against the remaining 24-hour quota.\n4. Flag any blockers — sandbox mode, unverified senders, or quota nearly exhausted.\n\n## Output\nReport sending enabled status, quota used versus max, and any unverified identities that would block the send.',
    },
  ],
} as const satisfies BlockMeta
