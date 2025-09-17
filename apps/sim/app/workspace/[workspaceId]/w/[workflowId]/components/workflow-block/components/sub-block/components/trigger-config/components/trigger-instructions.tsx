import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/utils'
import { JSONView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components'
import type { TriggerConfig } from '@/triggers/types'

interface TriggerInstructionsProps {
  instructions: string[]
  webhookUrl: string
  samplePayload: any
  triggerDef: TriggerConfig
  config?: Record<string, any>
}

export function TriggerInstructions({
  instructions,
  webhookUrl,
  samplePayload,
  triggerDef,
  config = {},
}: TriggerInstructionsProps) {
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const token = (config as any)?.token as string | undefined
  const secretHeaderName = (config as any)?.secretHeaderName as string | undefined
  const formId = (config as any)?.formId || '<YOUR_FORM_ID>'
  const headerLine = secretHeaderName
    ? `{ '${secretHeaderName}': TOKEN }`
    : "{ Authorization: 'Bearer ' + TOKEN }"

  const googleFormsSnippet = token
    ? `const WEBHOOK_URL = '${webhookUrl || '<WEBHOOK URL>'}';\nconst TOKEN = '${token}'; // from Sim Trigger Configuration\nconst FORM_ID = '${formId}';     // optional but recommended\n\nfunction onFormSubmit(e) {\n  var answers = {};\n  var formResponse = e && e.response;\n  if (formResponse && typeof formResponse.getItemResponses === 'function') {\n    var itemResponses = formResponse.getItemResponses() || [];\n    for (var i = 0; i < itemResponses.length; i++) {\n      var ir = itemResponses[i];\n      var question = ir.getItem().getTitle();\n      var value = ir.getResponse();\n      if (Array.isArray(value)) {\n        value = value.length === 1 ? value[0] : value;\n      }\n      answers[question] = value;\n    }\n  } else if (e && e.namedValues) {\n    var namedValues = e.namedValues || {};\n    for (var k in namedValues) {\n      var v = namedValues[k];\n      answers[k] = Array.isArray(v) ? (v.length === 1 ? v[0] : v) : v;\n    }\n  }\n\n  var payload = {\n    provider: 'googleforms',\n    formId: FORM_ID || undefined,\n    responseId: Utilities.getUuid(),\n    createTime: new Date().toISOString(),\n    lastSubmittedTime: new Date().toISOString(),\n    answers: answers,\n    raw: e || {}\n  };\n\n  UrlFetchApp.fetch(WEBHOOK_URL, {\n    method: 'post',\n    contentType: 'application/json',\n    payload: JSON.stringify(payload),\n    headers: ${headerLine},\n    muteHttpExceptions: true\n  });\n}`
    : `const WEBHOOK_URL = '${webhookUrl || '<WEBHOOK URL>'}';\nconst FORM_ID = '${formId}';     // optional but recommended\n\nfunction onFormSubmit(e) {\n  var answers = {};\n  var formResponse = e && e.response;\n  if (formResponse && typeof formResponse.getItemResponses === 'function') {\n    var itemResponses = formResponse.getItemResponses() || [];\n    for (var i = 0; i < itemResponses.length; i++) {\n      var ir = itemResponses[i];\n      var question = ir.getItem().getTitle();\n      var value = ir.getResponse();\n      if (Array.isArray(value)) {\n        value = value.length === 1 ? value[0] : value;\n      }\n      answers[question] = value;\n    }\n  } else if (e && e.namedValues) {\n    var namedValues = e.namedValues || {};\n    for (var k in namedValues) {\n      var v = namedValues[k];\n      answers[k] = Array.isArray(v) ? (v.length === 1 ? v[0] : v) : v;\n    }\n  }\n\n  var payload = {\n    provider: 'googleforms',\n    formId: FORM_ID || undefined,\n    responseId: Utilities.getUuid(),\n    createTime: new Date().toISOString(),\n    lastSubmittedTime: new Date().toISOString(),\n    answers: answers,\n    raw: e || {}\n  };\n\n  UrlFetchApp.fetch(WEBHOOK_URL, {\n    method: 'post',\n    contentType: 'application/json',\n    payload: JSON.stringify(payload),\n    muteHttpExceptions: true\n  });\n}`

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(googleFormsSnippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className='space-y-4'>
      <div className={cn('mt-4 rounded-md border border-border bg-card/50 p-4 shadow-sm')}>
        <h4 className='mb-3 font-medium text-base'>Setup Instructions</h4>
        <div className='space-y-1 text-muted-foreground text-sm [&_a]:text-muted-foreground [&_a]:underline [&_a]:hover:text-muted-foreground/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs'>
          <ol className='list-inside list-decimal space-y-2'>
            {instructions.map((instruction, index) => (
              <li key={index} dangerouslySetInnerHTML={{ __html: instruction }} />
            ))}
          </ol>
        </div>

        {triggerDef.provider === 'google_forms' && (
          <div className='mt-4'>
            <div className='relative overflow-hidden rounded-lg border border-border bg-card shadow-sm'>
              <div
                className='relative flex cursor-pointer items-center border-border/60 border-b bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/40'
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <div className='flex items-center gap-2'>
                  {isExpanded ? (
                    <ChevronDown className='h-4 w-4 text-muted-foreground' />
                  ) : (
                    <ChevronRight className='h-4 w-4 text-muted-foreground' />
                  )}
                  {triggerDef.icon && (
                    <triggerDef.icon className='h-4 w-4 text-[#611f69] dark:text-[#e01e5a]' />
                  )}
                  <h5 className='font-medium text-sm'>Apps Script snippet</h5>
                </div>
                {isExpanded && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={(e) => {
                      e.stopPropagation()
                      copySnippet()
                    }}
                    aria-label='Copy snippet'
                    className={cn(
                      'group -translate-y-1/2 absolute top-1/2 right-3 h-6 w-6 rounded-md p-0',
                      'text-muted-foreground/60 transition-all duration-200',
                      'hover:bg-muted/50 hover:text-foreground',
                      'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                    )}
                  >
                    {copied ? (
                      <Check className='h-3 w-3 text-foreground' />
                    ) : (
                      <Copy className='h-3 w-3' />
                    )}
                  </Button>
                )}
              </div>
              {isExpanded && (
                <div className='overflow-auto p-4'>
                  <pre className='whitespace-pre-wrap font-mono text-foreground text-xs leading-5'>
                    {googleFormsSnippet}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Notice
        variant='default'
        className='border-slate-200 bg-white dark:border-border dark:bg-background'
        icon={
          triggerDef.icon ? (
            <triggerDef.icon className='mt-0.5 mr-3.5 h-5 w-5 flex-shrink-0 text-[#611f69] dark:text-[#e01e5a]' />
          ) : null
        }
        title={`${triggerDef.provider.charAt(0).toUpperCase() + triggerDef.provider.slice(1).replace(/_/g, ' ')} Event Payload Example`}
      >
        Your workflow will receive a payload similar to this when a subscribed event occurs.
        <div className='overflow-wrap-anywhere mt-2 whitespace-normal break-normal font-mono text-sm'>
          <JSONView data={samplePayload} />
        </div>
      </Notice>
    </div>
  )
}
