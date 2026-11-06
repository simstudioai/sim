import 'server-only'
import type { ConversationData } from '@/platform/app/(shell)/_components/chat/conversation/model'
import type { Scenario } from '@/platform/fixtures'
import { FIXTURE_NOW } from '@/platform/fixtures/clock'

const EXAMPLES: Record<string, readonly [string, string, string, string][]> = {
  operations: [
    [
      'onboarding',
      'Customer onboarding',
      'What is left on the onboarding checklist?',
      'Confirm the account owner, send the welcome email, and schedule the kickoff.',
    ],
    [
      'account-review',
      'Account review notes',
      'What should I bring to the account review?',
      'Bring the renewal dates, open issues, and a list of decisions for the team.',
    ],
  ],
  finance: [
    [
      'forecast',
      'Quarterly forecast',
      'Summarize the inputs for the forecast.',
      'Start with booked revenue, planned spend, and the renewal pipeline.',
    ],
  ],
  revenue: [
    [
      'pipeline',
      'Pipeline review',
      'What should we cover in the pipeline review?',
      'Review new opportunities, slipped close dates, and deals that need a next step.',
    ],
  ],
}

export function workspaceChatThreads(
  workspaceId: string,
  scenario: Scenario
): ConversationData['threads'] {
  if (scenario === 'empty') return []
  const examples =
    scenario === 'stress' && workspaceId.startsWith('workspace-')
      ? EXAMPLES.operations
      : (EXAMPLES[workspaceId] ?? [])
  return examples.map(([slug, title, prompt, answer], index) => {
    const id = `${workspaceId}-${slug}`
    const sentAt = FIXTURE_NOW - (index + 1) * 3_600_000
    return {
      id,
      title,
      turns: [
        {
          id: `${id}-message`,
          prompt: { text: prompt, attachments: [] },
          sentAt,
          response: {
            state: 'complete',
            duration: '2s',
            steps: [],
            paragraphs: [{ text: answer }],
            sentAt: sentAt + 2000,
          },
        },
      ],
    }
  })
}
