import { BuildCallout } from '@/app/(landing)/components/features/components/build-callout/build-callout'
import { FeatureCard } from '@/app/(landing)/components/features/components/feature-card'
import { IntegrationsCallout } from '@/app/(landing)/components/features/components/integrations-callout/integrations-callout'
import { KnowledgeCallout } from '@/app/(landing)/components/features/components/knowledge-callout/knowledge-callout'
import { LogsCallout } from '@/app/(landing)/components/features/components/logs-callout'

/**
 * Landing features - how Sim works, as a platform lifecycle. Four beats, in the
 * order you actually use Sim: bring your tools in (Integrate), give it data to
 * reason over (Context), build the agent logic (Build), then watch it run
 * (Monitor). Each beat is a Cursor-style {@link FeatureCard}: one large
 * outlined card holding a media stage (backdrop painting + elevated real-UI
 * callout) and a copy column, with the media side alternating card to card.
 *
 * The section's `<h2>` is `sr-only` - each beat carries its own visible `<h3>`,
 * so the section heading exists only to anchor the heading hierarchy and give AI
 * crawlers an atomic summary.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. The section itself is FULL-WIDTH so
 * its bottom rule can bleed to the browser edges; the card grid inside carries
 * the shared gutter (`px-20`) and the `max-w-[1460px]` cap. The last card
 * squares its bottom corners (`flushBottom`) and sits exactly on the rule, so
 * its outline merges into the full-bleed divider.
 *
 * The cards stack in a single column at every width on a 112px rhythm
 * (matching Cursor's spacing between feature cards). Below `lg` each card
 * internally reflows media-over-copy.
 *
 * Per-beat icons are still abstract placeholders (text eyebrows); distinct
 * abstract glyphs land in a later pass.
 */
export function Features() {
  return (
    <section id='features' aria-labelledby='features-heading' className='relative w-full'>
      <h2 id='features-heading' className='sr-only'>
        Integrate your tools, give Sim context, build agents, and monitor every run.
      </h2>

      <div className='mx-auto grid w-full max-w-[1460px] grid-cols-1 gap-28 px-20 max-sm:gap-12 max-sm:px-5 max-lg:px-8'>
        {/* Integrate: bring your stack in. */}
        <FeatureCard
          eyebrow='Integrate'
          title='Connect the tools your work runs on.'
          description='Plug in 1,000+ integrations like Slack, HubSpot, Salesforce, and Notion, so Sim agents act across the stack you already use.'
          href='/integrations'
          linkLabel='Explore integrations'
          backdropSrc='/landing/feature-integrate-backdrop.jpg'
        >
          <IntegrationsCallout />
        </FeatureCard>

        {/* Context: store data semantically. */}
        <FeatureCard
          eyebrow='Context'
          title='Give Sim data it can reason over.'
          description='Sim stores your data in tables, files, and knowledge bases, the semantic memory agents read to ground every answer.'
          backdropSrc='/landing/feature-context-backdrop.jpg'
          mediaSide='right'
        >
          <KnowledgeCallout />
        </FeatureCard>

        {/* Build: wire agent logic in the visual builder. */}
        <FeatureCard
          eyebrow='Build'
          title='Build agents that solve real problems.'
          description="Wire blocks, models, and integrations into agent logic on Sim's visual builder, from one agent to many working in parallel."
          href='/workflows'
          linkLabel='Explore the workflow builder'
        >
          <BuildCallout />
        </FeatureCard>

        {/* Monitor: watch every run. */}
        <FeatureCard
          eyebrow='Monitor'
          title='Watch every run, end to end.'
          description='Sim traces each run block by block, with full logs and the real cost.'
          backdropSrc='/landing/feature-monitor-backdrop.jpg'
          mediaSide='right'
          flushBottom
        >
          <LogsCallout />
        </FeatureCard>
      </div>

      {/* Full-bleed rule the last card's squared bottom edge merges into -
          spans the whole browser, past the content cap and gutter (the section
          itself is full-width; only the card grid above is capped). */}
      <div aria-hidden='true' className='absolute inset-x-0 bottom-0 h-px bg-[var(--border)]' />
    </section>
  )
}
