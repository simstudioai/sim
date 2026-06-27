import { KetchIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const KetchBlockDisplay = {
  type: 'ketch',
  name: 'Ketch',
  description: 'Manage privacy consent, subscriptions, and data subject rights',
  category: 'tools',
  bgColor: '#9B5CFF',
  icon: KetchIcon,
  longDescription:
    'Integrate Ketch into the workflow. Retrieve and update consent preferences, manage subscription topics and controls, and submit data subject rights requests for access, deletion, correction, or processing restriction.',
  docsLink: 'https://docs.sim.ai/integrations/ketch',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const KetchBlockMeta = {
  tags: ['identity'],
  url: 'https://www.ketch.com',
  templates: [
    {
      icon: KetchIcon,
      title: 'Ketch consent propagator',
      prompt:
        'Build a workflow that on a consent change reads the contact’s Ketch consent state and propagates it to downstream systems — HubSpot and Loops — keeping privacy preferences in sync.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['hubspot', 'loops'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch DSR fulfillment',
      prompt:
        'Create a workflow that on a Ketch data subject request collects matching personal data from connected systems, generates the export, and writes the fulfillment audit.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch deletion-request handler',
      prompt:
        'Build a workflow that on a Ketch deletion request propagates the deletion to all connected systems, captures confirmations, and writes the chain of custody.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch consent-drift detector',
      prompt:
        'Create a scheduled workflow that compares Ketch consent state with downstream systems, flags drift, and writes a remediation queue for the privacy team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'monitoring'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch subscription sync',
      prompt:
        'Build a workflow that reads each contact’s Ketch subscription topics and mirrors the opt-in state to the marketing tool so unsubscribe preferences stay consistent across systems.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch right-invocation handler',
      prompt:
        'Create a workflow that on an incoming privacy request invokes the matching Ketch right for the data subject, captures the confirmation, and writes the action to a compliance file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: KetchIcon,
      title: 'Ketch consent-rate digest',
      prompt:
        'Build a scheduled monthly workflow that samples Ketch consent state across a contact list, computes opt-in rates per purpose, and writes a privacy report file for executive review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'check-user-consent',
      description: 'Look up a user current consent state in Ketch before processing their data.',
      content:
        '# Check User Consent\n\nConfirm what a user has consented to before a workflow uses their data.\n\n## Steps\n1. Identify the user (by identity key) and the jurisdiction/policy scope.\n2. Get the user current consent for the relevant purposes (analytics, marketing, etc.).\n3. Determine which downstream actions are permitted based on the consent state.\n\n## Output\nReturn the consent state per purpose and a clear allow/deny decision for the intended data use. Stop the workflow if required consent is missing.',
    },
    {
      name: 'record-consent-update',
      description: 'Set or update a user consent choices in Ketch from a preference change.',
      content:
        '# Record a Consent Update\n\nPersist a user updated consent choices to Ketch.\n\n## Steps\n1. Capture the user identity and the new consent choices per purpose.\n2. Set the consent for that user in the correct jurisdiction/policy scope.\n3. Read the consent back to confirm it was applied.\n\n## Output\nConfirm the user identity, the purposes updated, and the resulting consent state.',
    },
    {
      name: 'fulfill-data-subject-request',
      description: 'Invoke a data subject right (access, delete) in Ketch and track the request.',
      content:
        '# Fulfill a Data Subject Request\n\nKick off a DSR (e.g. access or deletion) on behalf of a user.\n\n## Steps\n1. Capture the requester identity and the right being exercised (access, deletion, correction).\n2. Invoke the right in Ketch with the required identity and jurisdiction context.\n3. Capture the request reference for tracking.\n\n## Output\nReturn the request reference, the right invoked, and the requester identity so the request can be tracked to completion.',
    },
    {
      name: 'sync-subscription-preferences',
      description:
        'Read a user subscription topics in Ketch and update them to honor an opt-in or opt-out.',
      content:
        '# Sync Subscription Preferences\n\nKeep a user communication preferences accurate in Ketch when they opt in or out of a channel or topic.\n\n## Steps\n1. Identify the user and get their current subscription topics and controls.\n2. Determine the requested change (e.g. opt out of the newsletter, set a global unsubscribe).\n3. Set the subscription topics and controls to the new state for that user.\n4. Read the subscriptions back to confirm the change applied.\n\n## Output\nReturn the topics and controls that changed and the resulting opt-in or opt-out state per channel. Confirm any global unsubscribe was honored.',
    },
  ],
} as const satisfies BlockMeta
