#!/usr/bin/env bun

/**
 * Compares top-level trigger output keys with keys returned from the provider's formatInput.
 *
 * Many trigger files import `buildTriggerSubBlocks` from `@/triggers`, which pulls the full
 * registry and is unsafe to load from a standalone script. This runner uses **per-provider
 * entry points** (utils + handler only) where implemented.
 *
 * Usage (from repo root):
 *   bun run apps/sim/scripts/check-trigger-alignment.ts <provider>
 *
 * Or from apps/sim:
 *   bun run scripts/check-trigger-alignment.ts <provider>
 */

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://127.0.0.1:5432/__sim_trigger_alignment_check_placeholder__'
}

import type { TriggerOutput } from '@/triggers/types'

type CheckFn = () => Promise<{
  referenceLabel: string
  outputKeys: string[]
  formatInputKeys: string[]
}>

const PROVIDER_CHECKS: Record<string, CheckFn> = {
  zoom: async () => {
    const { buildMeetingOutputs } = await import('@/triggers/zoom/utils')
    const { zoomHandler } = await import('@/lib/webhooks/providers/zoom')
    const outputs = buildMeetingOutputs() as Record<string, TriggerOutput>
    const result = await zoomHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        event: 'meeting.started',
        event_ts: 1700000000000,
        payload: { account_id: 'acct_1', object: { id: 123456789, uuid: 'abc' } },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildMeetingOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  gong: async () => {
    const { buildCallOutputs } = await import('@/triggers/gong/utils')
    const { gongHandler } = await import('@/lib/webhooks/providers/gong')
    const outputs = buildCallOutputs() as Record<string, TriggerOutput>
    const result = await gongHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {},
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildCallOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  linear: async () => {
    const { buildIssueOutputs } = await import('@/triggers/linear/utils')
    const { linearHandler } = await import('@/lib/webhooks/providers/linear')
    const outputs = buildIssueOutputs() as Record<string, TriggerOutput>
    const result = await linearHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        action: 'create',
        type: 'Issue',
        webhookId: 'wh_123',
        webhookTimestamp: Date.now(),
        organizationId: 'org_123',
        createdAt: new Date().toISOString(),
        url: 'https://linear.app',
        actor: { id: 'user_1', type: 'user', name: 'Test User' },
        data: {},
        updatedFrom: null,
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildIssueOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  resend: async () => {
    const { buildResendOutputs } = await import('@/triggers/resend/utils')
    const { resendHandler } = await import('@/lib/webhooks/providers/resend')
    const outputs = buildResendOutputs() as Record<string, TriggerOutput>
    const result = await resendHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        type: 'email.bounced',
        created_at: '2024-11-22T23:41:12.126Z',
        data: {
          broadcast_id: '8b146471-e88e-4322-86af-016cd36fd216',
          created_at: '2024-11-22T23:41:11.894719+00:00',
          email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
          from: 'Acme <onboarding@resend.dev>',
          to: ['delivered@resend.dev'],
          subject: 'Sending this example',
          template_id: '43f68331-0622-4e15-8202-246a0388854b',
          bounce: {
            message:
              "The recipient's email address is on the suppression list because it has a recent history of producing hard bounces.",
            subType: 'Suppressed',
            type: 'Permanent',
          },
          tags: { category: 'confirm_email' },
        },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildResendOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  notion: async () => {
    const { buildPageEventOutputs } = await import('@/triggers/notion/utils')
    const { notionHandler } = await import('@/lib/webhooks/providers/notion')
    const outputs = buildPageEventOutputs() as Record<string, TriggerOutput>
    const result = await notionHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        id: 'evt_123',
        type: 'page.created',
        timestamp: new Date().toISOString(),
        workspace_id: 'workspace_1',
        workspace_name: 'Workspace',
        subscription_id: 'sub_1',
        integration_id: 'int_1',
        attempt_number: 1,
        authors: [],
        accessible_by: [],
        entity: { id: 'page_1', type: 'page' },
        data: { parent: { id: 'parent_1', type: 'page' } },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildPageEventOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  salesforce: async () => {
    const { buildSalesforceWebhookOutputs } = await import('@/triggers/salesforce/utils')
    const { salesforceHandler } = await import('@/lib/webhooks/providers/salesforce')
    const outputs = buildSalesforceWebhookOutputs() as Record<string, TriggerOutput>
    const result = await salesforceHandler.formatInput!({
      webhook: { providerConfig: { triggerId: 'salesforce_webhook' } },
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        eventType: 'record_created',
        objectType: 'Account',
        Id: '001',
        Name: 'Acme',
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildSalesforceWebhookOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  vercel: async () => {
    const { buildVercelOutputs } = await import('@/triggers/vercel/utils')
    const { vercelHandler } = await import('@/lib/webhooks/providers/vercel')
    const outputs = buildVercelOutputs() as Record<string, TriggerOutput>
    const result = await vercelHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        type: 'deployment.created',
        id: 'evt_123',
        createdAt: Date.now(),
        region: 'iad1',
        payload: {
          deployment: {
            id: 'dep_1',
            url: 'example.vercel.app',
            name: 'preview',
            meta: { githubCommitSha: 'abc123' },
          },
          project: { id: 'prj_1', name: 'project' },
          team: { id: 'team_1' },
          user: { id: 'user_1' },
          target: 'preview',
          plan: 'pro',
          links: {
            deployment: 'https://vercel.com/acme/project/dep',
            project: 'https://vercel.com/acme/project',
          },
          regions: ['iad1'],
          domain: { name: 'example.com', delegated: false },
        },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildVercelOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  greenhouse: async () => {
    const { buildWebhookOutputs } = await import('@/triggers/greenhouse/utils')
    const { greenhouseHandler } = await import('@/lib/webhooks/providers/greenhouse')
    const outputs = buildWebhookOutputs() as Record<string, TriggerOutput>
    const result = await greenhouseHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        action: 'new_candidate_application',
        payload: {
          application: {
            id: 71980812,
            candidate: { id: 60304594 },
            jobs: [{ id: 274075, name: 'Engineer' }],
          },
        },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildWebhookOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  hubspot: async () => {
    const { buildWebhookOutputs } = await import('@/triggers/hubspot/utils')
    const { hubspotHandler } = await import('@/lib/webhooks/providers/hubspot')
    const outputs = buildWebhookOutputs() as Record<string, TriggerOutput>
    const sampleBody = [
      {
        objectId: 123,
        subscriptionType: 'contact.creation',
        portalId: 456,
        occurredAt: 1700000000000,
        attemptNumber: 0,
        eventId: 789,
        changeSource: 'CRM',
      },
    ]
    const result = await hubspotHandler.formatInput!({
      webhook: { providerConfig: { triggerId: 'hubspot_webhook' } },
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: sampleBody as unknown as Record<string, unknown>,
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildWebhookOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  intercom: async () => {
    const { buildIntercomGenericOutputs } = await import('@/triggers/intercom/utils')
    const { intercomHandler } = await import('@/lib/webhooks/providers/intercom')
    const outputs = buildIntercomGenericOutputs() as Record<string, TriggerOutput>
    const result = await intercomHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        topic: 'contact.created',
        id: 'notif_123',
        app_id: 'app_123',
        created_at: 1700000000,
        delivery_attempts: 1,
        first_sent_at: 1700000000,
        data: {
          item: {
            id: 'contact_1',
            email: 'ada@example.com',
          },
        },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'buildIntercomGenericOutputs()',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  github: async () => {
    const { repositoryOutputs, userOutputs } = await import('@/triggers/github/utils')
    const { githubHandler } = await import('@/lib/webhooks/providers/github')

    const outputs = {
      action: { type: 'string', description: 'GitHub action' },
      event_type: { type: 'string', description: 'GitHub event type' },
      branch: { type: 'string', description: 'Branch name' },
      repository: repositoryOutputs,
      sender: userOutputs,
    } as unknown as Record<string, TriggerOutput>

    const result = await githubHandler.formatInput!({
      webhook: {},
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        action: 'opened',
        ref: 'refs/heads/main',
        repository: {
          id: 1,
          node_id: 'node_1',
          name: 'sim',
          full_name: 'simstudioai/sim',
          private: true,
          html_url: 'https://github.com/simstudioai/sim',
          description: 'Repo',
          fork: false,
          url: 'https://api.github.com/repos/simstudioai/sim',
          homepage: null,
          size: 123,
          stargazers_count: 10,
          watchers_count: 10,
          language: 'TypeScript',
          forks_count: 2,
          open_issues_count: 3,
          default_branch: 'main',
          owner: {
            login: 'simstudioai',
            id: 1,
            avatar_url: 'https://avatars.githubusercontent.com/u/1',
            html_url: 'https://github.com/simstudioai',
          },
        },
        sender: {
          login: 'octocat',
          id: 2,
          node_id: 'node_2',
          avatar_url: 'https://avatars.githubusercontent.com/u/2',
          html_url: 'https://github.com/octocat',
          type: 'User',
        },
      },
      headers: { 'x-github-event': 'issues' },
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'github issue-shaped outputs',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  slack: async () => {
    const { slackHandler } = await import('@/lib/webhooks/providers/slack')

    const outputs = {
      event: {
        type: 'object',
        description: 'Slack event data',
        properties: {
          event_type: { type: 'string', description: 'Slack event type' },
          channel: { type: 'string', description: 'Channel ID' },
          channel_name: { type: 'string', description: 'Channel name' },
          user: { type: 'string', description: 'User ID' },
          user_name: { type: 'string', description: 'Username' },
          text: { type: 'string', description: 'Message text' },
          timestamp: { type: 'string', description: 'Message timestamp' },
          thread_ts: { type: 'string', description: 'Thread timestamp' },
          team_id: { type: 'string', description: 'Workspace ID' },
          event_id: { type: 'string', description: 'Event ID' },
          reaction: { type: 'string', description: 'Reaction name' },
          item_user: { type: 'string', description: 'Original message author' },
          hasFiles: { type: 'boolean', description: 'Whether files are attached' },
          files: { type: 'file[]', description: 'Downloaded files' },
        },
      },
    } as Record<string, TriggerOutput>

    const result = await slackHandler.formatInput!({
      webhook: { providerConfig: {} },
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        team_id: 'T123',
        event_id: 'Ev123',
        event: {
          type: 'app_mention',
          channel: 'C123',
          user: 'U123',
          text: 'hello',
          ts: '1700000000.0001',
          thread_ts: '1700000000.0001',
        },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'slackWebhookTrigger.outputs',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
  typeform: async () => {
    const { typeformHandler } = await import('@/lib/webhooks/providers/typeform')

    const outputs = {
      event_id: { type: 'string', description: 'Unique event identifier' },
      event_type: { type: 'string', description: 'Typeform event type' },
      form_id: { type: 'string', description: 'Form ID' },
      token: { type: 'string', description: 'Submission token' },
      submitted_at: { type: 'string', description: 'Submission timestamp' },
      landed_at: { type: 'string', description: 'Landing timestamp' },
      calculated: {
        type: 'object',
        description: 'Calculated values',
        properties: { score: { type: 'number', description: 'Score' } },
      },
      variables: { type: 'array', description: 'Variables' },
      hidden: { type: 'object', description: 'Hidden fields' },
      answers: { type: 'array', description: 'Answers' },
      ending: {
        type: 'object',
        description: 'Ending',
        properties: {
          id: { type: 'string', description: 'Ending id' },
          ref: { type: 'string', description: 'Ending ref' },
        },
      },
      raw: { type: 'object', description: 'Raw payload' },
    } as Record<string, TriggerOutput>

    const result = await typeformHandler.formatInput!({
      webhook: { providerConfig: { includeDefinition: false } },
      workflow: { id: 'check-alignment', userId: 'check-alignment' },
      body: {
        event_id: 'evt_1',
        event_type: 'form_response',
        form_response: {
          form_id: 'form_1',
          token: 'token_1',
          submitted_at: '2026-01-01T00:00:00Z',
          landed_at: '2026-01-01T00:00:00Z',
          calculated: { score: 5 },
          variables: [],
          hidden: {},
          answers: [],
          ending: { id: 'ending_1', ref: 'end_ref' },
        },
      },
      headers: {},
      requestId: 'check-trigger-alignment',
    })
    const input = result.input as Record<string, unknown>
    return {
      referenceLabel: 'typeformWebhookTrigger.outputs',
      outputKeys: Object.keys(outputs).sort(),
      formatInputKeys: Object.keys(input).sort(),
    }
  },
}

const provider = process.argv[2]?.trim()
if (!provider) {
  console.error('Usage: bun run apps/sim/scripts/check-trigger-alignment.ts <provider>')
  process.exit(1)
}

const run = PROVIDER_CHECKS[provider]
if (!run) {
  console.log(
    `[${provider}] No bundled alignment check yet. Add an entry to PROVIDER_CHECKS in apps/sim/scripts/check-trigger-alignment.ts (import utils + handler only, not @/triggers/registry), or compare output keys manually.`
  )
  process.exit(0)
}

const { referenceLabel, outputKeys, formatInputKeys } = await run()
const missingInInput = outputKeys.filter((k) => !formatInputKeys.includes(k))
const extraInInput = formatInputKeys.filter((k) => !outputKeys.includes(k))

console.log(`Provider: ${provider}`)
console.log(`Reference: ${referenceLabel}`)
console.log('outputs (top-level):', outputKeys.join(', ') || '(none)')
console.log('formatInput keys:', formatInputKeys.join(', ') || '(none)')

if (missingInInput.length > 0) {
  console.error('MISSING in formatInput:', missingInInput.join(', '))
}
if (extraInInput.length > 0) {
  console.warn('EXTRA in formatInput (not in outputs):', extraInInput.join(', '))
}

if (missingInInput.length > 0) {
  process.exit(1)
}

console.log(`\n[${provider}] Alignment check passed.`)
process.exit(0)
