import { Check, Copy } from 'lucide-react'
import { Button, Input, Label } from '@/components/ui'
import {
  ConfigField,
  ConfigSection,
  InstructionsSection,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/webhook/components'

interface GoogleFormsConfigProps {
  token: string
  setToken: (value: string) => void
  secretHeaderName: string
  setSecretHeaderName: (value: string) => void
  formId: string
  setFormId: (value: string) => void
  isLoadingToken: boolean
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  webhookUrl: string
}

export function GoogleFormsConfig({
  token,
  setToken,
  secretHeaderName,
  setSecretHeaderName,
  formId,
  setFormId,
  isLoadingToken,
  copied,
  copyToClipboard,
  webhookUrl,
}: GoogleFormsConfigProps) {
  const headerLine = secretHeaderName
    ? `{ '${secretHeaderName}': TOKEN }`
    : '{ Authorization: `Bearer ${' + 'TOKEN' + '}` }'

  const snippet = `const WEBHOOK_URL = '${webhookUrl}';
const TOKEN = '${token || '<SHARED_SECRET>'}'; // from Sim Trigger Configuration
const FORM_ID = '${formId || '<YOUR_FORM_ID>'}';     // optional but recommended

function onFormSubmit(e) {
  const answers = {};

  // Prefer Google Forms event object (e.response)
  const formResponse = e && e.response;
  if (formResponse && typeof formResponse.getItemResponses === 'function') {
    const itemResponses = formResponse.getItemResponses() || [];
    for (var i = 0; i < itemResponses.length; i++) {
      var ir = itemResponses[i];
      var question = ir.getItem().getTitle();
      var value = ir.getResponse();
      if (Array.isArray(value)) {
        value = value.length === 1 ? value[0] : value;
      }
      answers[question] = value;
    }
  } else if (e && e.namedValues) {
    // Fallback for spreadsheet-based flows
    var namedValues = e.namedValues || {};
    for (var k in namedValues) {
      var v = namedValues[k];
      answers[k] = Array.isArray(v) ? (v.length === 1 ? v[0] : v) : v;
    }
  }

  const payload = {
    provider: 'google_forms',
    formId: FORM_ID || undefined,
    responseId: Utilities.getUuid(),
    createTime: new Date().toISOString(),
    lastSubmittedTime: new Date().toISOString(),
    answers: answers,
    raw: e || {}
  };

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: ${headerLine},
    muteHttpExceptions: true
  });
}`

  return (
    <div className='space-y-4'>
      <ConfigSection title='Authentication'>
        <ConfigField
          id='gforms-shared-secret'
          label='Shared Secret *'
          description='Used to authenticate requests. Either sent as Authorization: Bearer or via a custom header.'
        >
          <Input
            id='gforms-shared-secret'
            type='password'
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder='Enter a strong secret'
          />
        </ConfigField>

        <ConfigField
          id='gforms-secret-header'
          label='Custom Secret Header (optional)'
          description='If set, Apps Script must send this header with the Shared Secret. Otherwise, use Authorization: Bearer.'
        >
          <Input
            id='gforms-secret-header'
            value={secretHeaderName}
            onChange={(e) => setSecretHeaderName(e.target.value)}
            placeholder='X-GForms-Secret'
          />
        </ConfigField>
      </ConfigSection>

      <ConfigSection title='Form'>
        <ConfigField
          id='gforms-form-id'
          label='Form ID (optional)'
          description='From your Google Form URL. Used for clarity in your workflow runs.'
        >
          <Input
            id='gforms-form-id'
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            placeholder='1FAIpQLSd...'
          />
        </ConfigField>
      </ConfigSection>

      <InstructionsSection tip='Copy this Apps Script into your Form project under Code.gs and add an installable trigger for "On form submit".'>
        <div className='mb-2'>
          <Label className='font-medium text-sm'>Apps Script snippet</Label>
        </div>
        <div className='relative'>
          <pre className='overflow-auto rounded border border-border bg-muted p-3 text-xs leading-5 dark:border-border/60'>
            {snippet}
          </pre>
          <div className='mt-2 flex justify-end'>
            <Button
              variant='outline'
              size='icon'
              onClick={() => copyToClipboard(snippet, 'apps-script')}
              disabled={isLoadingToken}
              aria-label='Copy snippet'
              className='h-8 w-8'
            >
              {copied === 'apps-script' ? (
                <Check className='h-4 w-4 text-green-500' />
              ) : (
                <Copy className='h-4 w-4' />
              )}
            </Button>
          </div>
        </div>
        <ol className='list-inside list-decimal space-y-1'>
          <li>Open your Google Form → More (⋮) → Script editor.</li>
          <li>
            Paste the snippet above into <code>Code.gs</code> and save.
          </li>
          <li>
            Click Triggers (clock icon) → Add Trigger → function <code>onFormSubmit</code>, Event
            source <code>From form</code>, Event type <code>On form submit</code>.
          </li>
          <li>Authorize when prompted and submit a test form response.</li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
