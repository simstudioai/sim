import type { RenderContext } from 'fumadocs-openapi'
import type { CodeUsageGeneratorRegistry } from 'fumadocs-openapi/requests/generators'
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from 'fumadocs-ui/components/codeblock'

interface APIRequestTabsProps {
  registry: CodeUsageGeneratorRegistry
  context: RenderContext
}

/** Keeps highlighted samples mounted so changing languages does not restart Shiki. */
export function APIRequestTabs({ registry, context }: APIRequestTabsProps) {
  const samples = Array.from(registry.map().entries())
  const first = samples[0]
  if (!first) return null
  const UsageTab = context.clientBoundary.UsageTab

  return (
    <CodeBlockTabs groupId='fumadocs_openapi_requests' defaultValue={first[0]}>
      <CodeBlockTabsList aria-label='Request language'>
        {samples.map(([id, sample]) => (
          <CodeBlockTabsTrigger
            key={id}
            value={id}
            className='focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-[-2px]'
          >
            {sample.label ?? sample.lang}
          </CodeBlockTabsTrigger>
        ))}
      </CodeBlockTabsList>
      {samples.map(([id, sample]) => (
        <CodeBlockTab key={id} value={id} forceMount className='data-[state=inactive]:hidden'>
          <UsageTab id={id} lang={sample.lang} _client={sample._client} />
        </CodeBlockTab>
      ))}
    </CodeBlockTabs>
  )
}
