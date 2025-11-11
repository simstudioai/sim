import { GoogleFormsIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const googleFormsWebhookTrigger: TriggerConfig = {
  id: 'google_forms_webhook',
  name: 'Google Forms Webhook',
  provider: 'google_forms',
  description: 'Trigger workflow from Google Form submissions (via Apps Script forwarder)',
  version: '1.0.0',
  icon: GoogleFormsIcon,

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
      id: 'token',
      title: 'Shared Secret',
      type: 'short-input',
      placeholder: 'Enter a secret used by your Apps Script forwarder',
      description:
        'We validate requests using this secret. Send it as Authorization: Bearer <token> or a custom header.',
      password: true,
      required: true,
      mode: 'trigger',
    },
    {
      id: 'secretHeaderName',
      title: 'Custom Secret Header',
      type: 'short-input',
      placeholder: 'X-GForms-Secret',
      description:
        'If set, the webhook will validate this header equals your Shared Secret instead of Authorization.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'formId',
      title: 'Form ID',
      type: 'short-input',
      placeholder: '1FAIpQLSd... (Google Form ID)',
      description:
        'Optional, for clarity and matching in workflows. Not required for webhook to work.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'includeRawPayload',
      title: 'Include Raw Payload',
      type: 'switch',
      description: 'Include the original payload from Apps Script in the workflow input.',
      defaultValue: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Open your Google Form → More (⋮) → Script editor.',
        'Paste the Apps Script snippet from below into <code>Code.gs</code> → Save.',
        'Triggers (clock icon) → Add Trigger → Function: <code>onFormSubmit</code> → Event source: <code>From form</code> → Event type: <code>On form submit</code> → Save.',
        'Authorize when prompted. Submit a test response and verify the run in Sim → Logs.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'setupScript',
      title: 'Apps Script Code',
      type: 'code',
      language: 'javascript',
      value: (params: Record<string, any>) => {
        const script = `function onFormSubmit(e) {
  const WEBHOOK_URL = "{{WEBHOOK_URL}}";
  const SHARED_SECRET = "{{SHARED_SECRET}}";
  
  try {
    const form = FormApp.getActiveForm();
    const formResponse = e.response;
    const itemResponses = formResponse.getItemResponses();
    
    // Build answers object
    const answers = {};
    for (var i = 0; i < itemResponses.length; i++) {
      const itemResponse = itemResponses[i];
      const question = itemResponse.getItem().getTitle();
      const answer = itemResponse.getResponse();
      answers[question] = answer;
    }
    
    // Build payload
    const payload = {
      provider: "google_forms",
      formId: form.getId(),
      responseId: formResponse.getId(),
      createTime: formResponse.getTimestamp().toISOString(),
      lastSubmittedTime: formResponse.getTimestamp().toISOString(),
      answers: answers
    };
    
    // Send to webhook
    const options = {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": "Bearer " + SHARED_SECRET
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    
    if (response.getResponseCode() !== 200) {
      Logger.log("Webhook failed: " + response.getContentText());
    } else {
      Logger.log("Successfully sent form response to webhook");
    }
  } catch (error) {
    Logger.log("Error in onFormSubmit: " + error.toString());
  }
}`
        const webhookUrl = params.webhookUrlDisplay || ''
        const token = params.token || ''
        return script
          .replace(/\{\{WEBHOOK_URL\}\}/g, webhookUrl)
          .replace(/\{\{SHARED_SECRET\}\}/g, token)
      },
      collapsible: true,
      defaultCollapsed: true,
      showCopyButton: true,
      description: 'Copy this code and paste it into your Google Forms Apps Script editor',
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'google_forms_webhook',
    },
  ],

  outputs: {
    responseId: { type: 'string', description: 'Unique response identifier (if available)' },
    createTime: { type: 'string', description: 'Response creation timestamp' },
    lastSubmittedTime: { type: 'string', description: 'Last submitted timestamp' },
    formId: { type: 'string', description: 'Google Form ID' },
    answers: { type: 'object', description: 'Normalized map of question -> answer' },
    raw: { type: 'object', description: 'Original payload (when enabled)' },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
