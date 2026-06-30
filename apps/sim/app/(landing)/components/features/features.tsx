import {
  CalloutFrame,
  FeatureStage,
} from '@/app/(landing)/components/features/components/feature-stage/feature-stage'
import { FormationGraph } from '@/app/(landing)/components/features/components/formation-graph/formation-graph'
import { IntegrationsCallout } from '@/app/(landing)/components/features/components/integrations-callout/integrations-callout'
import { KnowledgeCallout } from '@/app/(landing)/components/features/components/knowledge-callout/knowledge-callout'
import { LogsTablePreview } from '@/app/(landing)/components/features/components/logs-table-preview'

/**
 * Landing features - how Sim works, as a platform lifecycle. Four beats, in the
 * order you actually use Sim: bring your tools in (Integrate), give it data to
 * reason over (Context), build the agent logic (Build), then watch it run
 * (Monitor). Each beat uses one shared {@link FeatureStage} template: a copy
 * block over a static, edge-faded platform backdrop with an elevated real-UI
 * callout floating on the left.
 *
 * The section's `<h2>` is `sr-only` - each beat carries its own visible `<h3>`,
 * so the section heading exists only to anchor the heading hierarchy and give AI
 * crawlers an atomic summary.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-12`) matches
 * the navbar and hero; the section is capped and centered at the shared
 * `max-w-[1446px]`.
 *
 * The four beats sit in a one-column grid that, like the rest of the page,
 * scales down via `max-*` overrides. From `xl` up (and through the 1024-1279
 * band) they stay a single full-width column on the 120px inter-section rhythm,
 * so a beat break reads identically to a section break. At and below `lg`
 * (≤1023) they reflow into a compact 2x2 grid; on phones (≤639) they drop back to
 * a single column. {@link FeatureStage} hides its floating callout and drops its
 * edge masks at the same `lg` breakpoint, so each grid cell shows the un-masked
 * preview under its copy.
 *
 * Per-beat icons are still abstract placeholders (text eyebrows); distinct
 * abstract glyphs land in a later pass.
 */
export function Features() {
  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='relative mx-auto w-full max-w-[1446px] px-12 max-sm:px-5 max-lg:px-8'
    >
      <h2 id='features-heading' className='sr-only'>
        Integrate your tools, give Sim context, build agents, and monitor every run.
      </h2>

      <div className='grid grid-cols-1 gap-[120px] max-sm:grid-cols-1 max-sm:gap-16 max-lg:grid-cols-2 max-lg:gap-x-8 max-lg:gap-y-12'>
        {/* Integrate: bring your stack in. */}
        <FeatureStage
          eyebrow='Integrate'
          title='Connect the tools your work runs on.'
          description='Plug in 1,000+ integrations like Slack, HubSpot, Salesforce, and Notion, so Sim agents act across the stack you already use.'
          view='workflow'
          workflowId='wf-self-healing-crm'
          callout={<IntegrationsCallout />}
        />

        {/* Context: store data semantically. */}
        <FeatureStage
          eyebrow='Context'
          title='Give Sim data it can reason over.'
          description='Sim stores your data semantically in tables, files, and knowledge bases your agents read from to ground every answer in your own data.'
          view='tables'
          callout={<KnowledgeCallout />}
        />

        {/* Build: wire agent logic in the visual builder. */}
        <FeatureStage
          eyebrow='Build'
          title='Build agents that solve real problems.'
          description='Wire blocks, models, and integrations into agent logic on a visual builder, from one agent to many working in parallel.'
          view='workflow'
          workflowId='wf-customer-support'
          callout={<FormationGraph />}
        />

        {/* Monitor: watch every run. */}
        <FeatureStage
          eyebrow='Monitor'
          title='Watch every run, end to end.'
          description='Trace each run block by block, with full logs and the real cost, so you always know what ran and why.'
          view='workflow'
          workflowId='wf-it-service'
          callout={
            <CalloutFrame className='w-[480px]' bodyClassName='h-[300px]' fade>
              <LogsTablePreview />
            </CalloutFrame>
          }
        />
      </div>
    </section>
  )
}
