import 'server-only'
import type { Scenario } from '@/platform/fixtures'
import type {
  SlackSearchInstallationView,
  SlackSearchList,
} from '@/platform/lib/data/settings-slack'

const connected: SlackSearchInstallationView = {
  id: 'operations-bot',
  credentialId: 'sim-search',
  appId: 'A01SEARCH',
  teamId: 'T01OPS',
  teamName: 'Customer operations',
  appKind: 'shared',
  enabled: true,
  needsValidation: false,
  lastEventAt: null,
  lastOutcome: null,
}

function inventory(scenario: Scenario): SlackSearchList {
  if (scenario === 'empty')
    return { sharedAppAvailable: false, memberAppKind: null, installations: [], bots: [] }
  const custom: SlackSearchInstallationView = {
    ...connected,
    id: 'research-bot',
    credentialId: 'research',
    teamId: 'T02RESEARCH',
    teamName: 'Research',
    appId: 'A02SEARCH',
    appKind: 'custom',
    enabled: false,
    needsValidation: true,
  }
  return {
    sharedAppAvailable: scenario === 'full',
    memberAppKind: scenario === 'full' ? 'shared' : 'custom',
    installations: [
      connected,
      custom,
      ...(scenario === 'stress'
        ? [
            {
              ...custom,
              id: 'support-bot',
              credentialId: 'support',
              teamId: 'T03SUPPORT',
              teamName: 'Customer support',
              needsValidation: false,
              lastOutcome: 'delivery_failed',
            },
          ]
        : []),
    ],
    bots: [
      { id: 'research', displayName: 'Research search' },
      { id: 'support', displayName: 'Customer support' },
    ],
  }
}

export function slackSettings(scenario: Scenario) {
  return {
    inventory: inventory(scenario),
    prospective: connected,
    origin: 'https://sim.example.test',
  }
}
