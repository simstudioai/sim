import 'server-only'
import type { SettingsData } from '@/platform/app/(shell)/settings/_components/model'
import type { Scenario } from '@/platform/fixtures'

const owner = { id: 'emir', name: 'Emir Karabeg', email: 'emir@example.com' }
const full: SettingsData = {
  email: owner.email,
  members: [
    owner,
    { id: 'jo', name: 'Jo Bell', email: 'jo@example.test' },
    { id: 'alex', name: 'Alex Rowan', email: 'alex@example.test' },
    { id: 'remy', name: 'Remy Chen', email: 'remy@example.test' },
    { id: 'mina', name: 'Mina Kim', email: 'mina@example.test' },
  ],
  connections: ['Google Calendar', 'Gmail', 'Salesforce'],
}

export const settingsScenarios: Record<Scenario, SettingsData> = {
  full,
  empty: { email: owner.email, members: [owner], connections: [] },
  stress: {
    ...full,
    members: [
      owner,
      ...Array.from({ length: 177 }, (_, i) => ({
        id: `member-${i + 1}`,
        name: `International customer operations member ${i + 1}`,
        email: `customer-operations-${i + 1}@example.test`,
      })),
    ],
  },
}
