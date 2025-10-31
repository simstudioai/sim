import { WebflowIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const webflowCollectionItemChangedTrigger: TriggerConfig = {
  id: 'webflow_collection_item_changed',
  name: 'Collection Item Changed',
  provider: 'webflow',
  description:
    'Trigger workflow when an item is updated in a Webflow CMS collection (requires Webflow credentials)',
  version: '1.0.0',
  icon: WebflowIcon,

  subBlocks: [
    // Credentials
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires webflow credentials to access your account.',
      provider: 'webflow',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
    // Site
    {
      id: 'siteId',
      title: 'Site',
      type: 'dropdown',
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      options: [],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
    // Collection
    {
      id: 'collectionId',
      title: 'Collection',
      type: 'dropdown',
      placeholder: 'Select a collection (optional)',
      description: 'Optionally filter to monitor only a specific collection',
      required: false,
      options: [],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
    // Setup Instructions
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: [
        'Connect your Webflow account using the "Select Webflow credential" button above.',
        'Enter your Webflow Site ID (found in the site URL or site settings).',
        'Optionally enter a Collection ID to monitor only specific collections.',
        'If no Collection ID is provided, the trigger will fire for items changed in any collection on the site.',
        'The webhook will trigger whenever an existing item is updated in the specified collection(s).',
        'Make sure your Webflow account has appropriate permissions for the specified site.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
    // Webhook URL
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
    // Save Button
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'webflow_collection_item_changed',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
    // Sample Payload
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          siteId: '68f9666057aa8abaa9b0b668',
          workspaceId: '68f96081e7018465432953b5',
          collectionId: '68f9666257aa8abaa9b0b6d6',
          payload: {
            id: '68fa8445de250e147cd95cfd',
            cmsLocaleId: '68f9666257aa8abaa9b0b6c9',
            lastPublished: '2024-01-15T14:45:00.000Z',
            lastUpdated: '2024-01-15T14:45:00.000Z',
            createdOn: '2024-01-15T10:30:00.000Z',
            isArchived: false,
            isDraft: false,
            fieldData: {
              name: 'Updated Blog Post',
              slug: 'updated-blog-post',
              'post-summary': 'This blog post has been updated',
              featured: true,
            },
          },
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_changed',
      },
    },
  ],

  outputs: {
    siteId: {
      type: 'string',
      description: 'The site ID where the event occurred',
    },
    workspaceId: {
      type: 'string',
      description: 'The workspace ID where the event occurred',
    },
    collectionId: {
      type: 'string',
      description: 'The collection ID where the item was changed',
    },
    payload: {
      id: { type: 'string', description: 'The ID of the changed item' },
      cmsLocaleId: { type: 'string', description: 'CMS locale ID' },
      lastPublished: { type: 'string', description: 'Last published timestamp' },
      lastUpdated: { type: 'string', description: 'Last updated timestamp' },
      createdOn: { type: 'string', description: 'Timestamp when the item was created' },
      isArchived: { type: 'boolean', description: 'Whether the item is archived' },
      isDraft: { type: 'boolean', description: 'Whether the item is a draft' },
      fieldData: { type: 'object', description: 'The updated field data of the item' },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
