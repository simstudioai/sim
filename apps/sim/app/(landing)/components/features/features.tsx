import { LogsTablePreview } from '@/app/(landing)/components/feature-callouts/components/logs-table-preview/logs-table-preview'
import { ModelPickerPreview } from '@/app/(landing)/components/feature-callouts/components/model-picker-preview/model-picker-preview'
import { DeployCallout } from '@/app/(landing)/components/features/components/deploy-callout/deploy-callout'
import {
  CalloutFrame,
  FeatureStage,
} from '@/app/(landing)/components/features/components/feature-stage/feature-stage'
import { FormationGraph } from '@/app/(landing)/components/features/components/formation-graph/formation-graph'
import { MothershipChatCallout } from '@/app/(landing)/components/features/components/mothership-chat-callout/mothership-chat-callout'

/**
 * Landing features — the "show here" half of the Mothership story. The section
 * directly above ({@link Mothership}) *defines* the five capabilities (Mothership
 * · Pod · Formation · Dispatch · Return); this section *shows* each one as a real
 * Sim UI moment, using one shared {@link FeatureStage} template per beat: a copy
 * block over a static, faded platform backdrop with an elevated real-UI callout.
 *
 * The section's `<h2>` is `sr-only` — each beat carries its own visible `<h3>`,
 * so the section heading exists only to anchor the heading hierarchy and give AI
 * crawlers an atomic summary. The five beats follow, stacked.
 *
 * Inter-section spacing is owned by the `<main>` flex `gap` in `landing.tsx`;
 * this section carries no vertical padding. Horizontal padding (`px-12`) matches
 * the navbar and hero; the section is capped and centered at the shared
 * `max-w-[1446px]`. A negative bottom margin pulls the following section up into
 * the last stage's faded bottom edge so the platform dissolves into it.
 */
export function Features() {
  return (
    <section
      id='features'
      aria-labelledby='features-heading'
      className='mx-auto -mb-[90px] w-full max-w-[1446px] px-12'
    >
      <h2 id='features-heading' className='sr-only'>
        Build, deploy, and run AI agents — all in Sim.
      </h2>

      <div className='flex flex-col gap-32'>
        {/* Mothership — command the workspace in plain language. */}
        <FeatureStage
          eyebrow='Mothership'
          title='Just say what you want built.'
          description='Describe the agent you need in plain language. Mothership reads your workspace, grounds itself in what already exists, and builds — no blank canvas.'
          view='workflow'
          workflowId='wf-self-healing-crm'
          callout={<MothershipChatCallout />}
        />

        {/* Pod — one agent, one job, any model. */}
        <FeatureStage
          eyebrow='Pod'
          title='One agent. One job. Any model.'
          description='A Pod is a single agent wired to any major LLM and 1,000+ integrations, pointed at one task in your systems.'
          view='workflow'
          workflowId='wf-self-healing-crm'
          callout={
            <CalloutFrame className='w-[340px]' bodyClassName='h-[300px]' fade>
              <ModelPickerPreview />
            </CalloutFrame>
          }
        />

        {/* Formation — many agents on one problem, in parallel. */}
        <FeatureStage
          eyebrow='Formation'
          title='Put many agents on one problem.'
          description='Run agents in parallel and merge their work into one result — a Formation scales past what a single agent can do.'
          view='workflow'
          workflowId='wf-customer-support'
          callout={<FormationGraph />}
        />

        {/* Dispatch — ship to production, three ways. */}
        <FeatureStage
          eyebrow='Dispatch'
          title='Ship it anywhere it needs to run.'
          description='Deploy any agent as an API, a Slack bot, or a scheduled run — live in one click.'
          view='scheduled-tasks'
          callout={<DeployCallout />}
        />

        {/* Return — every run comes back legible. */}
        <FeatureStage
          eyebrow='Return'
          title='Every run comes back legible.'
          description='Trace each run block by block, with full logs and the real cost — so you always know what ran, and why.'
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
