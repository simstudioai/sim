import { Check, CircleAlert } from '@sim/emcn/icons'
import { ContentInteractions } from '@/components/docs/content-interactions'
import { ProseTable } from '@/components/docs/mdx'
import { DocsButton, MethodBadge, NeutralBadge } from '@/components/docs/primitives'
import { Callout } from '@/components/ui/callout'
import { Card, Cards } from '@/components/ui/cards'
import { CodeBlock } from '@/components/ui/code-block'
import { Heading } from '@/components/ui/heading'
import { Image } from '@/components/ui/image'
import { ReferenceDetails } from '@/components/ui/reference-details'
import { Step, Steps } from '@/components/ui/steps'
import { Tab, Tabs } from '@/components/ui/tabs'
import { CLASSIFY_WORKFLOW, OutputBundle, WorkflowPreview } from '@/components/workflow-preview'

/** A local, noindex gallery exercises the same component registry used by documentation. */
export function DocsGallery() {
  return (
    <div className='mx-auto max-w-[728px] py-10'>
      <ContentInteractions />
      <Heading as='h1'>Docs component library</Heading>
      <p className='text-docs-body'>
        The shared Sim design system for authored pages, generated references, and interactive
        examples. Update the shared components to change every page.
      </p>
      <Heading id='controls'>Controls and semantic labels</Heading>
      <div className='flex flex-wrap items-center gap-3'>
        <DocsButton>Rest</DocsButton>
        <DocsButton disabled>Disabled</DocsButton>
        <DocsButton aria-busy>
          <span className='size-3 animate-spin rounded-full border border-current border-r-transparent motion-reduce:animate-none' />
          Loading
        </DocsButton>
        <NeutralBadge>Read</NeutralBadge>
        <NeutralBadge>Write</NeutralBadge>
        <NeutralBadge>MCP</NeutralBadge>
      </div>
      <div className='mt-5 flex flex-wrap gap-3'>
        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
          <MethodBadge key={method} method={method} />
        ))}
      </div>
      <Heading id='callouts'>Callouts and prerequisites</Heading>
      <Callout title='Before you begin'>
        You need a workspace where you can edit and run workflows.
      </Callout>
      <Callout title='Note'>Keep consequential information visible.</Callout>
      <Callout type='success' title='Run completed' icon={<Check className='size-4' />}>
        Open Logs to inspect the output.
      </Callout>
      <Callout type='warn' title='Check your permissions'>
        This operation needs write access.
      </Callout>
      <Callout
        type='error'
        title='Could not load the example'
        icon={<CircleAlert className='size-4' />}
      >
        The surrounding documentation remains available.
      </Callout>
      <Heading id='tabs'>Tabs, code, and copying</Heading>
      <Tabs items={['Bun', 'npm', 'pnpm']} aria-label='Package manager'>
        <Tab value='Bun'>
          <CodeBlock title='Install the CLI' lang='bash' code={'bun add -g sim\nsim --version'} />
        </Tab>
        <Tab value='npm'>
          <CodeBlock
            title='Install the CLI'
            lang='bash'
            code={'npm install -g sim\nsim --version'}
          />
        </Tab>
        <Tab value='pnpm'>
          <CodeBlock title='Install the CLI' lang='bash' code={'pnpm add -g sim\nsim --version'} />
        </Tab>
      </Tabs>
      <CodeBlock
        title='Contained horizontal overflow'
        code={
          'curl "https://www.sim.ai/api/v2/workspaces/00000000-0000-4000-8000-000000000000/workflows?limit=100&cursor=example-long-pagination-cursor"'
        }
      />
      <Heading id='disclosures'>Disclosures and nested fields</Heading>
      <ReferenceDetails label='View optional configuration'>
        <Heading as='h3' id='nested-anchor'>
          A bookmarked nested heading
        </Heading>
        <p className='text-docs-body'>Opening this anchor reveals the surrounding disclosure.</p>
        <ReferenceDetails label='Child fields'>
          <p className='text-docs-body'>
            All children stay in the HTML for browser find and machine access.
          </p>
        </ReferenceDetails>
      </ReferenceDetails>
      <Heading id='steps'>Sequential instructions</Heading>
      <Steps>
        <Step>
          <Heading as='h3'>Create a workflow</Heading>
          <p>Choose a workflow from your workspace.</p>
        </Step>
        <Step>
          <Heading as='h3'>Run and inspect</Heading>
          <p>Open Logs to inspect its result.</p>
        </Step>
      </Steps>
      <Heading id='tables'>Tables and route rows</Heading>
      <ProseTable>
        <thead>
          <tr>
            <th className='py-3 pr-6'>Field</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className='py-3 pr-6 font-mono'>workspaceId</td>
            <td>Workspace containing the workflow.</td>
          </tr>
          <tr>
            <td className='py-3 pr-6 font-mono'>nextCursor</td>
            <td>Opaque cursor for the next page.</td>
          </tr>
        </tbody>
      </ProseTable>
      <Cards>
        <Card href='/getting-started' title='Getting started'>
          Build and run your first workflow.
        </Card>
        <Card href='/api-reference' title='API reference'>
          Read the generated operation reference.
        </Card>
      </Cards>
      <Heading id='media'>Platform screenshots</Heading>
      <Image
        src='/static/introduction/platform.webp'
        alt='Sim workspace with a table beside Chat'
        width={2400}
        height={1200}
        caption='The original platform asset, in the shared image frame.'
      />
      <Heading id='workflow'>Workflow inspector</Heading>
      <WorkflowPreview workflow={CLASSIFY_WORKFLOW} />
      <OutputBundle
        blockName='classify'
        values={[
          { key: 'content', type: 'string', value: 'Billing, high urgency', expanded: true },
          {
            key: 'tokens',
            type: 'object',
            children: [
              { key: 'input', type: 'number', value: '412' },
              { key: 'output', type: 'number', value: '38' },
            ],
          },
        ]}
      />
    </div>
  )
}
