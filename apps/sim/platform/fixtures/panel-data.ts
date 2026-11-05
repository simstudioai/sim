import 'server-only'
import type { PanelData } from '@/platform/app/(shell)/chat/_components/panel/model'
import type { Scenario } from '@/platform/fixtures'
import { FIXTURE_NOW } from '@/platform/fixtures/clock'
import linear from '@/platform/fixtures/media/linear-homepage.jpg'

const full: PanelData = {
  asOf: FIXTURE_NOW,
  recents: [
    { id: 'github', label: 'GitHub', icon: 'I045', destination: 'website', address: 'github.com' },
    {
      id: 'gmail',
      label: 'Gmail',
      icon: 'I005',
      destination: 'website',
      address: 'mail.google.com',
    },
    { id: 'renewal', label: 'Renewal brief', icon: 'I015', destination: 'file' },
    { id: 'customer', label: 'Customer operations', destination: 'workspace' },
    {
      id: 'linear',
      label: 'Linear',
      icon: 'I007',
      destination: 'website',
      address: 'linear.app/homepage',
    },
    { id: 'onboarding', label: 'Q4 onboarding', destination: 'workspace' },
    { id: 'notion', label: 'Notion', icon: 'I022', destination: 'website', address: 'notion.so' },
    { id: 'revenue', label: 'Revenue operations', destination: 'workspace' },
    { id: 'marketing', label: 'Marketing', destination: 'workspace' },
    { id: 'people', label: 'People operations', destination: 'workspace' },
    { id: 'finance', label: 'Finance', destination: 'workspace' },
  ],
  file: {
    title: 'Aster Labs renewal brief',
    updatedAt: FIXTURE_NOW - 12 * 60_000,
    properties: [
      { label: 'Owner', value: 'Alex Chen' },
      { label: 'Renewal', value: 'November 13' },
      { label: 'Status', value: 'In review' },
    ],
    sections: [
      {
        title: 'Account summary',
        text: 'Aster Labs uses Sim to coordinate customer onboarding, triage support requests, and prepare weekly operating reviews.',
      },
      {
        title: 'Confirm the rollout owner',
        text: 'Alex will coordinate the next phase. Confirm the handoff from Maya before Friday’s call and update the account plan.',
      },
      {
        title: 'Reporting request',
        text: 'The team needs a weekly summary of failed runs, including the owner, resolution, and next action.',
      },
      {
        title: 'Expansion timing',
        text: 'The account team is planning a December launch. Align the renewal plan with the revised timeline.',
      },
      {
        title: 'Next steps',
        text: 'Confirm ownership, agree on a reporting date, and share the updated rollout plan after the call.',
      },
    ],
  },
  website: { name: 'Linear', address: 'linear.app/homepage', image: linear.src },
  terminal:
    '~/customer-operations $ ls\nbriefs    exports    scripts\n\n~/customer-operations $ cat briefs/renewal.md\n# Renewal brief\n\nConfirm the rollout owner and reporting timeline.\n\n~/customer-operations $',
}

export const panelScenarios: Record<Scenario, PanelData | null> = {
  empty: null,
  full,
  stress: {
    ...full,
    recents: [
      ...full.recents,
      ...['customer-onboarding', 'account-planning', 'implementation-notes', 'renewal-review'].map(
        (name) => ({
          id: name,
          label: name.replaceAll('-', ' '),
          icon: 'I045' as const,
          destination: 'website' as const,
          address: `github.com/topics/${name}`,
        })
      ),
    ],
    terminal: `${Array.from({ length: 50 }, (_, i) => `[run ${i + 1}] Checking workflow status…\nRun completed.`).join('\n')}\n~/customer-operations $`,
  },
}
