import { JotformIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const jotformWebhookTrigger: TriggerConfig = {
  id: 'jotform_webhook',
  name: 'Jotform Webhook',
  provider: 'jotform',
  description: 'Trigger workflow when a Jotform form receives a new submission',
  version: '1.0.0',
  icon: JotformIcon,

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'formId',
      title: 'Form ID',
      canvasNoun: 'a form',
      type: 'short-input',
      placeholder: 'e.g., 231504059977966',
      description:
        'The form to watch. It is the numeric segment of the form URL, and the List Forms operation returns it.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Jotform API key',
      description:
        'Used to register the webhook on the form automatically. Create one under Account Settings > API.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      /* Named apart from the block's own `region` field: the two live in the same block
         and a shared id would collide across tool mode and trigger mode. */
      id: 'apiRegion',
      title: 'Region',
      type: 'dropdown',
      description:
        'Data residency region the API key belongs to. A key only works on the host that issued it.',
      options: [
        { label: 'US (api.jotform.com)', id: 'us' },
        { label: 'EU (eu-api.jotform.com)', id: 'eu' },
        { label: 'HIPAA (hipaa-api.jotform.com)', id: 'hipaa' },
      ],
      value: () => 'us',
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Create an API key at <a href="https://www.jotform.com/myaccount/api" target="_blank" rel="noopener noreferrer">https://www.jotform.com/myaccount/api</a> and give it Full Access, since read-only keys cannot add webhooks',
        'Pick the region your account is on. EU and HIPAA accounts are served by different hosts, and a key is rejected by every host but its own',
        'Copy the Form ID from the form URL, e.g. <code>https://www.jotform.com/build/231504059977966</code> gives <code>231504059977966</code>',
        'Sim registers the webhook on that form when you deploy the workflow, and removes it again when you undeploy',
        '<strong>Note:</strong> Only submissions made through the form fire this trigger. Submissions created through the API do not.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    formId: {
      type: 'string',
      description: 'ID of the form that was submitted',
    },
    submissionId: {
      type: 'string',
      description: 'ID of the new submission',
    },
    formTitle: {
      type: 'string',
      description: 'Title of the form at the time of submission',
    },
    username: {
      type: 'string',
      description: 'Jotform account username that owns the form',
    },
    ip: {
      type: 'string',
      description: 'IP address the submission came from',
    },
    submissionType: {
      type: 'string',
      description: 'How the submission was made, e.g. WEB',
    },
    pretty: {
      type: 'string',
      description:
        'Human-readable summary of the answers, as comma-separated "Question Label:Answer" pairs. Unanswered questions are left out.',
    },
    rawRequest: {
      type: 'json',
      description:
        'The submitted form body. Answers are keyed q{questionId}_{slugifiedLabel} and hold a string, or an object for a multi-part question such as name or address. A file answer instead appears under the plain slugified label as an array of upload URLs, with the chosen filenames under temp_upload. The body also carries form-internal fields such as slug, buildDate, submitSource, and jsExecutionTracker.',
    },
    raw: {
      type: 'json',
      description: 'Complete original webhook payload from Jotform',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  },
}
