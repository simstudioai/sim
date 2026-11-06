import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import ninaPhoto from '@/platform/fixtures/media/attendee-1.jpg'
import alexPhoto from '@/platform/fixtures/media/attendee-2.jpg'
import mayaPhoto from '@/platform/fixtures/media/attendee-3.jpg'
import type {
  IntegrationCenterData,
  IntegrationPerson,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'

const emir: IntegrationPerson = { id: 'emir', name: 'Emir Karabeg' }
const nina: IntegrationPerson = { id: 'nina', name: 'Nina Patel', src: ninaPhoto.src }
const alex: IntegrationPerson = { id: 'alex', name: 'Alex Chen', src: alexPhoto.src }
const maya: IntegrationPerson = { id: 'maya', name: 'Maya Thompson', src: mayaPhoto.src }
const daniel: IntegrationPerson = { id: 'daniel', name: 'Daniel Kim' }
const people = [emir, nina, alex, maya, daniel]
const organization = { id: 'sim', name: 'Sim Enterprise' }

const resources: IntegrationResource[] = [
  {
    id: 'weekly-customer-review',
    kind: 'skill',
    name: 'Weekly customer review',
    description: 'Turn customer conversations into a concise weekly account review.',
    instructions:
      'Review the latest customer conversations. Summarize goals, decisions, open questions, and next steps. Link each finding to its source and identify an owner for each follow-up.',
    scope: 'shared',
    owner: nina,
    people: [nina, emir, maya],
    canEdit: true,
  },
  {
    id: 'release-notes',
    kind: 'skill',
    name: 'Release notes',
    description: 'Draft clear, customer-facing notes from completed engineering work.',
    instructions:
      'Group completed work into features, improvements, and fixes. Describe the user-visible change in plain language. Include a source link for each item and omit internal implementation details.',
    scope: 'shared',
    owner: alex,
    people: [alex, daniel],
    canEdit: false,
  },
  {
    id: 'meeting-preparation',
    kind: 'skill',
    name: 'Meeting preparation',
    description: 'Gather the context, open questions, and decisions for my next meeting.',
    instructions:
      'Read the meeting agenda and relevant conversations. Prepare a short brief with context, unresolved questions, and decisions needed. Finish with links to the source material.',
    scope: 'personal',
    owner: emir,
    people: [],
    canEdit: true,
  },
  {
    id: 'research-summary',
    kind: 'skill',
    name: 'Research summary',
    description: 'Compare sources and extract the findings that matter for my research.',
    instructions:
      'Compare the supplied sources. Distinguish evidence from assumptions, flag disagreements, and summarize practical implications. Cite the source for each substantive claim.',
    scope: 'personal',
    owner: emir,
    people: [],
    canEdit: true,
  },
  {
    id: 'customer-knowledge',
    kind: 'mcp',
    name: 'Customer knowledge',
    description: 'Search the support knowledge base and customer account context.',
    url: 'https://customer-knowledge.example.com/mcp',
    auth: 'oauth',
    scope: 'shared',
    owner: nina,
    people: [nina, emir, maya, daniel],
    canEdit: true,
  },
  {
    id: 'engineering-tools',
    kind: 'mcp',
    name: 'Engineering tools',
    description: 'Read service documentation and inspect deployment information.',
    url: 'https://engineering-tools.example.com/mcp',
    auth: 'bearer',
    scope: 'shared',
    owner: alex,
    people: [alex, daniel],
    canEdit: false,
  },
  {
    id: 'research-library',
    kind: 'mcp',
    name: 'Research library',
    description: 'Search my saved papers, reading notes, and references.',
    url: 'https://research-library.example.com/mcp',
    auth: 'oauth',
    scope: 'personal',
    owner: emir,
    people: [],
    canEdit: true,
  },
  {
    id: 'customer-io-key',
    kind: 'credential',
    name: 'Customer.io',
    description: 'The operations team’s key for customer messaging workflows.',
    key: 'CUSTOMER_IO_API_KEY',
    credentialType: 'api-key',
    scope: 'shared',
    owner: nina,
    people: [nina, emir, maya],
    canEdit: true,
  },
  {
    id: 'webhook-signing-secret',
    kind: 'credential',
    name: 'Webhook signing secret',
    description: 'Verifies events received by the engineering workspace.',
    key: 'WEBHOOK_SIGNING_SECRET',
    credentialType: 'secret',
    scope: 'shared',
    owner: alex,
    people: [alex, daniel],
    canEdit: false,
  },
  {
    id: 'research-api-key',
    kind: 'credential',
    name: 'Research API',
    description: 'My API key for research and enrichment.',
    key: 'RESEARCH_API_KEY',
    credentialType: 'api-key',
    scope: 'personal',
    owner: emir,
    people: [],
    canEdit: true,
  },
]

const workspaces = [
  {
    id: 'customer-operations',
    name: 'Customer operations',
    memberIds: ['emir', 'nina', 'alex', 'maya'],
  },
  { id: 'engineering', name: 'Engineering', memberIds: ['emir', 'alex', 'daniel'] },
] as const

export function integrationCenterData(scenario: Scenario): IntegrationCenterData {
  if (scenario === 'empty')
    return {
      organization,
      viewer: emir,
      people,
      workspaces,
      appPeople: {},
      appUsageTotal: {},
      resources: [],
    }
  const extra =
    scenario === 'stress'
      ? Array.from({ length: 60 }, (_, index): IntegrationResource => {
          const source = resources[index % resources.length]
          if (!source) throw new Error('Integration center resources are missing')
          return {
            ...source,
            id: `${source.id}-${index + 1}`,
            name: `${source.name} for international customer operations ${index + 1}`,
            description:
              'Shared context for customer onboarding, regional operations, and long-running research across the team. Includes supporting references and detailed instructions.',
          }
        })
      : []
  return {
    organization,
    viewer: emir,
    workspaces,
    people,
    appUsageTotal: { gmail: scenario === 'stress' ? 1002 : 15, google_drive: 24 },
    appPeople: {
      gmail: [nina, alex, maya, emir, daniel],
      google_calendar: [nina, alex, maya, emir],
      google_drive: [nina, alex, maya, emir, daniel],
      github: [emir, alex, daniel],
      fireflies: [emir, nina, maya],
      hubspot: [nina, emir],
      salesforce: [nina, maya],
      notion: [alex, daniel],
      linear: [alex, daniel],
    },
    resources: [...resources, ...extra],
  }
}
