'use client'

import { useState } from 'react'
import { Check, Clipboard } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Code,
  Combobox,
  Label,
  Tooltip,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'

interface WorkflowDeploymentInfo {
  isDeployed: boolean
  deployedAt?: string
  apiKey: string
  endpoint: string
  exampleCommand: string
  needsRedeployment: boolean
}

interface ApiDeployProps {
  workflowId: string | null
  deploymentInfo: WorkflowDeploymentInfo | null
  isLoading: boolean
  needsRedeployment: boolean
  apiDeployError: string | null
  getInputFormatExample: (includeStreaming?: boolean) => string
  selectedStreamingOutputs: string[]
  onSelectedStreamingOutputsChange: (outputs: string[]) => void
}

type AsyncExampleType = 'execute' | 'status' | 'rate-limits'
type CodeLanguage = 'curl' | 'python' | 'javascript' | 'typescript'

type CopiedState = {
  endpoint: boolean // @remark: not used
  sync: boolean
  stream: boolean
  async: boolean
}

const LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  curl: 'cURL',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
}

const LANGUAGE_SYNTAX: Record<CodeLanguage, 'python' | 'javascript' | 'json'> = {
  curl: 'javascript',
  python: 'python',
  javascript: 'javascript',
  typescript: 'javascript',
}

export function ApiDeploy({
  workflowId,
  deploymentInfo,
  isLoading,
  needsRedeployment,
  apiDeployError,
  getInputFormatExample,
  selectedStreamingOutputs,
  onSelectedStreamingOutputsChange,
}: ApiDeployProps) {
  const [asyncExampleType, setAsyncExampleType] = useState<AsyncExampleType>('execute')
  const [language, setLanguage] = useState<CodeLanguage>('curl')
  const [copied, setCopied] = useState<CopiedState>({
    endpoint: false, // @remark: not used
    sync: false,
    stream: false,
    async: false,
  })

  const info = deploymentInfo ? { ...deploymentInfo, needsRedeployment } : null

  const getBaseEndpoint = () => {
    if (!info) return ''
    return info.endpoint.replace(info.apiKey, '$SIM_API_KEY')
  }

  const getPayloadObject = (): Record<string, unknown> => {
    const inputExample = getInputFormatExample ? getInputFormatExample(false) : ''
    const match = inputExample.match(/-d\s*'([\s\S]*)'/)
    if (match) {
      try {
        return JSON.parse(match[1]) as Record<string, unknown>
      } catch {
        return { input: 'your data here' }
      }
    }
    return { input: 'your data here' }
  }

  const getStreamPayloadObject = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...getPayloadObject(), stream: true }
    if (selectedStreamingOutputs && selectedStreamingOutputs.length > 0) {
      payload.selectedOutputs = selectedStreamingOutputs
    }
    return payload
  }

  const getSyncCommand = (): string => {
    if (!info) return ''
    const endpoint = getBaseEndpoint()
    const payload = getPayloadObject()

    switch (language) {
      case 'curl':
        return `curl -X POST \\
  -H "X-API-Key: $SIM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}' \\
  ${endpoint}`

      case 'python':
        return `import os
import requests

response = requests.post(
    "${endpoint}",
    headers={
        "X-API-Key": os.environ.get("SIM_API_KEY"),
        "Content-Type": "application/json"
    },
    json=${JSON.stringify(payload, null, 4).replace(/\n/g, '\n    ')}
)

print(response.json())`

      case 'javascript':
        return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const data = await response.json();
console.log(data);`

      case 'typescript':
        return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const data: Record<string, unknown> = await response.json();
console.log(data);`

      default:
        return ''
    }
  }

  const getStreamCommand = (): string => {
    if (!info) return ''
    const endpoint = getBaseEndpoint()
    const payload = getStreamPayloadObject()

    switch (language) {
      case 'curl':
        return `curl -X POST \\
  -H "X-API-Key: $SIM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload)}' \\
  ${endpoint}`

      case 'python':
        return `import os
import requests

response = requests.post(
    "${endpoint}",
    headers={
        "X-API-Key": os.environ.get("SIM_API_KEY"),
        "Content-Type": "application/json"
    },
    json=${JSON.stringify(payload, null, 4).replace(/\n/g, '\n    ')},
    stream=True
)

for line in response.iter_lines():
    if line:
        print(line.decode("utf-8"))`

      case 'javascript':
        return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`

      case 'typescript':
        return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`

      default:
        return ''
    }
  }

  const getAsyncCommand = (): string => {
    if (!info) return ''
    const endpoint = getBaseEndpoint()
    const baseUrl = endpoint.split('/api/workflows/')[0]
    const payload = getPayloadObject()

    switch (asyncExampleType) {
      case 'execute':
        switch (language) {
          case 'curl':
            return `curl -X POST \\
  -H "X-API-Key: $SIM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "X-Execution-Mode: async" \\
  -d '${JSON.stringify(payload)}' \\
  ${endpoint}`

          case 'python':
            return `import os
import requests

response = requests.post(
    "${endpoint}",
    headers={
        "X-API-Key": os.environ.get("SIM_API_KEY"),
        "Content-Type": "application/json",
        "X-Execution-Mode": "async"
    },
    json=${JSON.stringify(payload, null, 4).replace(/\n/g, '\n    ')}
)

job = response.json()
print(job)  # Contains jobId and executionId`

          case 'javascript':
            return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json",
    "X-Execution-Mode": "async"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const job = await response.json();
console.log(job); // Contains jobId and executionId`

          case 'typescript':
            return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.SIM_API_KEY,
    "Content-Type": "application/json",
    "X-Execution-Mode": "async"
  },
  body: JSON.stringify(${JSON.stringify(payload)})
});

const job: { jobId: string; executionId: string } = await response.json();
console.log(job); // Contains jobId and executionId`

          default:
            return ''
        }

      case 'status':
        switch (language) {
          case 'curl':
            return `curl -H "X-API-Key: $SIM_API_KEY" \\
  ${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION`

          case 'python':
            return `import os
import requests

response = requests.get(
    "${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION",
    headers={"X-API-Key": os.environ.get("SIM_API_KEY")}
)

status = response.json()
print(status)`

          case 'javascript':
            return `const response = await fetch(
  "${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION",
  {
    headers: { "X-API-Key": process.env.SIM_API_KEY }
  }
);

const status = await response.json();
console.log(status);`

          case 'typescript':
            return `const response = await fetch(
  "${baseUrl}/api/jobs/JOB_ID_FROM_EXECUTION",
  {
    headers: { "X-API-Key": process.env.SIM_API_KEY }
  }
);

const status: Record<string, unknown> = await response.json();
console.log(status);`

          default:
            return ''
        }

      case 'rate-limits':
        switch (language) {
          case 'curl':
            return `curl -H "X-API-Key: $SIM_API_KEY" \\
  ${baseUrl}/api/users/me/usage-limits`

          case 'python':
            return `import os
import requests

response = requests.get(
    "${baseUrl}/api/users/me/usage-limits",
    headers={"X-API-Key": os.environ.get("SIM_API_KEY")}
)

limits = response.json()
print(limits)`

          case 'javascript':
            return `const response = await fetch(
  "${baseUrl}/api/users/me/usage-limits",
  {
    headers: { "X-API-Key": process.env.SIM_API_KEY }
  }
);

const limits = await response.json();
console.log(limits);`

          case 'typescript':
            return `const response = await fetch(
  "${baseUrl}/api/users/me/usage-limits",
  {
    headers: { "X-API-Key": process.env.SIM_API_KEY }
  }
);

const limits: Record<string, unknown> = await response.json();
console.log(limits);`

          default:
            return ''
        }

      default:
        return ''
    }
  }

  const getAsyncExampleTitle = () => {
    switch (asyncExampleType) {
      case 'execute':
        return 'Execute Job'
      case 'status':
        return 'Check Status'
      case 'rate-limits':
        return 'Rate Limits'
      default:
        return 'Execute Job'
    }
  }

  const handleCopy = (key: keyof CopiedState, value: string) => {
    navigator.clipboard.writeText(value)
    setCopied((prev) => ({ ...prev, [key]: true }))
    setTimeout(() => setCopied((prev) => ({ ...prev, [key]: false })), 2000)
  }

  if (isLoading || !info) {
    return (
      <div className='space-y-[16px]'>
        {apiDeployError && (
          <div className='rounded-[4px] border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm'>
            <div className='font-semibold'>API Deployment Error</div>
            <div>{apiDeployError}</div>
          </div>
        )}
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[62px]' />
          <Skeleton className='h-[28px] w-[260px] rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[90px]' />
          <Skeleton className='h-[120px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[180px]' />
          <Skeleton className='h-[160px] w-full rounded-[4px]' />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-[16px]'>
      {apiDeployError && (
        <div className='rounded-[4px] border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm'>
          <div className='font-semibold'>API Deployment Error</div>
          <div>{apiDeployError}</div>
        </div>
      )}

      <div>
        <div className='mb-[6.5px] flex items-center justify-between'>
          <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Language
          </Label>
        </div>
        <ButtonGroup value={language} onValueChange={(val) => setLanguage(val as CodeLanguage)}>
          {(Object.keys(LANGUAGE_LABELS) as CodeLanguage[]).map((lang) => (
            <ButtonGroupItem key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      <div>
        <div className='mb-[6.5px] flex items-center justify-between'>
          <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Run workflow
          </Label>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                onClick={() => handleCopy('sync', getSyncCommand())}
                aria-label='Copy command'
                className='!p-1.5 -my-1.5'
              >
                {copied.sync ? <Check className='h-3 w-3' /> : <Clipboard className='h-3 w-3' />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <span>{copied.sync ? 'Copied' : 'Copy'}</span>
            </Tooltip.Content>
          </Tooltip.Root>
        </div>
        <Code.Viewer
          code={getSyncCommand()}
          language={LANGUAGE_SYNTAX[language]}
          wrapText
          className='!min-h-0 rounded-[4px] border border-[var(--border-1)]'
        />
      </div>

      <div>
        <div className='mb-[6.5px] flex items-center justify-between'>
          <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Run workflow (stream response)
          </Label>
          <div className='flex items-center gap-[6px]'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={() => handleCopy('stream', getStreamCommand())}
                  aria-label='Copy command'
                  className='!p-1.5 -my-1.5'
                >
                  {copied.stream ? (
                    <Check className='h-3 w-3' />
                  ) : (
                    <Clipboard className='h-3 w-3' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>{copied.stream ? 'Copied' : 'Copy'}</span>
              </Tooltip.Content>
            </Tooltip.Root>
            <OutputSelect
              workflowId={workflowId}
              selectedOutputs={selectedStreamingOutputs}
              onOutputSelect={onSelectedStreamingOutputsChange}
              placeholder='Select outputs'
              valueMode='label'
              align='end'
            />
          </div>
        </div>
        <Code.Viewer
          code={getStreamCommand()}
          language={LANGUAGE_SYNTAX[language]}
          wrapText
          className='!min-h-0 rounded-[4px] border border-[var(--border-1)]'
        />
      </div>

      <div>
        <div className='mb-[6.5px] flex items-center justify-between'>
          <Label className='block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Run workflow (async)
          </Label>
          <div className='flex items-center gap-[6px]'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  onClick={() => handleCopy('async', getAsyncCommand())}
                  aria-label='Copy command'
                  className='!p-1.5 -my-1.5'
                >
                  {copied.async ? <Check className='h-3 w-3' /> : <Clipboard className='h-3 w-3' />}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>{copied.async ? 'Copied' : 'Copy'}</span>
              </Tooltip.Content>
            </Tooltip.Root>
            <Combobox
              size='sm'
              className='!w-fit !py-[2px] min-w-[100px] rounded-[6px] px-[9px]'
              options={[
                { label: 'Execute Job', value: 'execute' },
                { label: 'Check Status', value: 'status' },
                { label: 'Rate Limits', value: 'rate-limits' },
              ]}
              value={asyncExampleType}
              onChange={(value) => setAsyncExampleType(value as AsyncExampleType)}
              align='end'
              dropdownWidth={160}
            />
          </div>
        </div>
        <Code.Viewer
          code={getAsyncCommand()}
          language={LANGUAGE_SYNTAX[language]}
          wrapText
          className='!min-h-0 rounded-[4px] border border-[var(--border-1)]'
        />
      </div>
    </div>
  )
}
