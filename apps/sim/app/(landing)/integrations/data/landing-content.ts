/**
 * Hand-authored, integration-specific landing content, keyed by integration
 * slug. This is a pure-data generation input: `scripts/generate-docs.ts` reads
 * it and bakes the matching entry into `integrations.json`, so the landing page
 * consumes a single source (`integration.landingContent`) with no render-time
 * augmentation. Has no app imports so the build script can import it safely.
 */

import type { IntegrationLandingContent } from '@/app/(landing)/integrations/data/types'

export const INTEGRATION_LANDING_CONTENT: Record<string, IntegrationLandingContent> = {
  slack: {
    install: {
      heading: 'Add Sim to your Slack workspace',
      intro:
        'Sim connects to Slack through Slack’s official OAuth flow. The “Add to Slack” button lives inside your Sim account (after sign-in) — connect from there and the Sim bot is installed in your Slack workspace. The steps below show exactly how to reach it.',
      steps: [
        {
          title: 'Create your free Sim account',
          body: 'Sign up at sim.ai — no credit card required.',
        },
        {
          title: 'Add a Slack block',
          body: 'Open a workflow, drag in a Slack block, and open its credential dropdown.',
        },
        {
          title: 'Connect Slack',
          body: 'Click Connect Slack, choose your workspace, and approve the requested permissions. This installs the Sim bot in your Slack workspace.',
        },
        {
          title: 'Invite the bot and build',
          body: 'Invite the Sim bot to the channels it should act in, pick a Slack action, wire it into your agent, and run.',
        },
      ],
    },
    privacy: {
      body: 'Sim requests only the Slack permissions its actions and triggers need, and never shows private channel names or messages to people who are not members of those channels in Slack.',
      href: '/privacy',
    },
    aiDisclaimer:
      'Sim agents use AI models to generate messages and responses sent to Slack. AI-generated content can be inaccurate or incomplete — review automated outputs before relying on them, especially for important communications.',
  },
}
