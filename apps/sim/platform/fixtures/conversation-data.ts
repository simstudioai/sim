import 'server-only'
import type { ChatAttachment, ChatTurn } from '@/platform/app/(shell)/_components/composer/model'
import type { ConversationData } from '@/platform/app/(shell)/chat/_components/conversation/model'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import type { Scenario } from '@/platform/fixtures'
import nina from '@/platform/fixtures/media/attendee-1.jpg'
import alex from '@/platform/fixtures/media/attendee-2.jpg'
import maya from '@/platform/fixtures/media/attendee-3.jpg'
import dashboard from '@/platform/fixtures/media/dashboard-preview.jpg'

const people = ['Nina Patel', 'Alex Chen', 'Maya Ross', 'Daniel Kim'].map((name, index) => ({
  name,
  src: [nina, alex, maya][index]?.src,
}))
const weekly = [7000, 10500, 9000, 14000, 11500, 17000, 15739]
const fullHome: HomeData = {
  firstName: 'Emir',
  address: 'emir@example.test',
  connected: true,
  ranges: [7, 30, 90].map((days) => ({
    label: `Last ${days} days`,
    points: Array.from({ length: days }, (_, i) => ({
      label: days === 7 ? `Oct ${7 + i}` : `Day ${i + 1}`,
      value: weekly[i % weekly.length],
    })),
  })),
  attention: [
    {
      id: 'onboarding',
      title: 'Review the onboarding process',
      detail: 'Approval requested in Wiki',
      meta: '13h ago',
      icon: 'I082',
    },
    {
      id: 'salesforce',
      title: 'Reconnect Salesforce',
      detail: 'Connection expired',
      meta: '12m ago',
      icon: 'I084',
    },
  ],
  email: [
    {
      id: 'checklist',
      sender: 'Nina Patel',
      avatar: nina.src,
      count: 3,
      subject: 'Updated onboarding checklist',
      excerpt:
        'I’ve added the new handoff steps, linked the implementation brief, and marked the owners for each checkpoint. Could you review the customer-facing notes before the kickoff on Thursday?',
      received: '12m ago',
    },
    {
      id: 'q4',
      sender: 'Alex Chen',
      avatar: alex.src,
      count: 2,
      subject: 'Q4 customer review',
      excerpt:
        'Can you review the agenda before Friday? I’ve included the latest pipeline report, the decisions from our last review, and the accounts that still need an owner.',
      received: '38m ago',
    },
    {
      id: 'invoice',
      sender: 'Maya Ross',
      avatar: maya.src,
      subject: 'Invoice approval for October',
      excerpt:
        'The final invoices are ready for approval. I reconciled the vendor totals against the October ledger and added notes about the two adjustments we discussed.',
      received: '1d ago',
    },
    ...[
      [
        'field-notes',
        'Daniel Kim',
        'Field notes from the pilot',
        'The support team collected feedback from all four pilot accounts. I grouped the requests by owner and marked the ones blocking rollout.',
        '1d ago',
      ],
      [
        'brand',
        'Jo Bell',
        'New brand assets',
        'The final icons and presentation templates are ready for the partner launch. Let me know if you need any additional formats.',
        '2d ago',
      ],
      [
        'research',
        'Amara Okafor',
        'Research interviews',
        'The interview guide is ready for review. I left space for the questions we discussed during the last research session.',
        '2d ago',
      ],
      [
        'handoff',
        'Leo Martin',
        'Implementation handoff',
        'Could you review the checklist before I send it to the implementation team?',
        '3d ago',
      ],
      [
        'forecast',
        'Priya Singh',
        'Forecast for November',
        'The latest model reflects the enterprise renewals and the revised account opening dates.',
        '3d ago',
      ],
      [
        'training',
        'Jordan Lee',
        'Training next week',
        'I added the new material to the agenda and shared the practice worksheet with everyone attending.',
        '4d ago',
      ],
      [
        'launch',
        'Sam Rivera',
        'Launch checklist',
        'The last remaining dependency is approved. We can now book the final launch review.',
        '4d ago',
      ],
      [
        'budget',
        'Leah Park',
        'Budget review',
        'The revised budget is ready. Each department has confirmed their allocation for the next quarter.',
        '5d ago',
      ],
      [
        'feedback',
        'Owen Reed',
        'Customer feedback roundup',
        'Here are the themes from the latest customer conversations, together with the owners and follow-up dates we agreed on.',
        '6d ago',
      ],
    ].map(([id, sender, subject, excerpt, received]) => ({
      id,
      sender,
      subject,
      excerpt,
      received,
    })),
  ],
  calendar: {
    date: '2026-10-13',
    now: '11:24 AM',
    nowMinute: 11 * 60 + 24,
    meetings: [
      {
        id: 'customer',
        title: 'Customer operations review',
        time: '10:30–11:15 AM',
        startMinute: 10 * 60 + 30,
        duration: 45,
        people,
      },
      {
        id: 'product',
        title: 'Product & revenue sync',
        time: '12:00–12:45 PM',
        startMinute: 12 * 60,
        duration: 45,
        people: people.slice(1, 3),
      },
    ],
  },
}
const renewal = {
  id: 'renewal',
  time: '3:46 PM',
  prompt: {
    text: 'Review the renewal brief for Aster Labs. Compare it with the latest account notes and highlight anything I should address before Friday’s call.',
    attachments: [],
  },
  response: {
    state: 'complete',
    duration: '38s',
    time: '4:04 PM',
    thinking: 'Compared the renewal terms with account notes and open requests.',
    paragraphs: [
      {
        text: 'The renewal is in good shape. There are three things worth addressing before Friday’s call.',
      },
      {
        lead: 'Confirm the rollout owner.',
        text: 'The brief names Maya, but the latest account note assigns the next phase to Alex. Clarify who will own the handoff.',
      },
      {
        lead: 'Resolve the reporting request.',
        text: 'Aster asked for a weekly summary of failed runs. The request is still open and should be included in the renewal plan.',
      },
      {
        lead: 'Align on the expansion timing.',
        text: 'The proposal assumes a November launch. The account team is planning for December.',
      },
      {
        text: 'I’d open the call with ownership and timing, then agree on a date for the reporting update.',
      },
    ],
    steps: [
      {
        id: 'read',
        name: 'Read renewal-brief.pdf',
        time: '1.2s',
        input: '{ "file": "renewal-brief.pdf", "pages": "1–12" }',
        output: JSON.stringify(
          {
            account: 'Aster Labs',
            renewal_date: '2026-11-30',
            rollout_owner: 'Maya Ross',
            expansion: 'November',
            open_requests: ['Weekly run summary'],
          },
          null,
          2
        ),
      },
      {
        id: 'ownership',
        name: 'Search account notes for ownership',
        time: '0.8s',
        input: '{"query":"ownership"}',
        output: 'Alex Chen will coordinate the next phase.',
      },
      {
        id: 'timing',
        name: 'Search account notes for rollout timing',
        time: '2.6s',
        input: '{"query":"rollout timing"}',
        output: 'The account team is planning for December.',
      },
      {
        id: 'requests',
        name: 'Read open reporting requests',
        time: '2.8s',
        input: '{"status":"open"}',
        output: 'Weekly summary of failed runs.',
      },
    ],
  },
} satisfies ChatTurn
const files: ChatAttachment[] = [
  {
    id: 'dashboard',
    kind: 'image',
    name: 'dashboard.png',
    metadata: '1440 × 1016',
    source: dashboard.src,
  },
  {
    id: 'brief',
    kind: 'document',
    name: 'renewal-brief.pdf',
    metadata: '12 pages',
    content:
      'Aster Labs renewal brief\nNovember 2026\n\nThe next phase expands the customer operations workspace and introduces a weekly summary of run activity.',
  },
  {
    id: 'notes',
    kind: 'text',
    name: 'Pasted text',
    metadata: 'Account notes',
    content:
      'Account review — Aster Labs\n\nConfirm the rollout owner before Friday. Align the expansion date with the account team. Add the reporting request to the renewal agenda.',
  },
]
function thread(
  id: string,
  title: string,
  text: string,
  state: 'running' | 'failed' | 'stopped',
  attachments: ChatAttachment[] = []
) {
  const entry = renewal.response
  return {
    id,
    title,
    turns: [
      {
        id,
        time: '10:42 AM',
        prompt: { text, attachments },
        response: {
          ...entry,
          state,
          duration: state === 'failed' ? '8s' : '12s',
          steps:
            state === 'failed'
              ? [{ ...entry.steps[0], time: '8s', output: 'File unavailable.' }]
              : entry.steps,
          thinking: undefined,
          failure:
            state === 'failed'
              ? 'I couldn’t read the renewal brief because the file is no longer available. Upload it again, or retry if access has been restored.'
              : undefined,
          progress:
            state === 'running'
              ? 'I’m comparing the renewal terms with the latest account notes and checking for unresolved requests.'
              : undefined,
          paragraphs:
            state === 'stopped'
              ? [
                  { text: 'I found an ownership mismatch in the renewal brief.' },
                  {
                    text: 'The brief lists Maya Ross, while the latest notes name Alex Chen as the owner for the next phase.',
                  },
                ]
              : [],
        },
      },
    ],
  }
}
const threads: ConversationData['threads'] = [
  { id: 'weekly-review', title: 'Review the renewal brief', turns: [renewal] },
  thread(
    'customer-onboarding',
    'Customer onboarding',
    'Compare these files and summarize the handoff.',
    'running',
    files
  ),
  thread(
    'october-close',
    'Prepare October close',
    'Review the reconciliation report and highlight any missing records.',
    'failed',
    [files[1]]
  ),
  thread('q4-planning', 'Q4 planning', 'Prepare the operating plan for next quarter.', 'stopped', [
    files[2],
  ]),
  ...[
    [
      'handoff',
      'Plan the implementation handoff',
      'What should I send to the implementation lead?',
      'Send the kickoff notes, the customer’s target date, and the list of outstanding access requests. Maya owns the first check-in.',
    ],
    [
      'forecast',
      'Explain the variance between the quarterly pipeline forecast and the operating plan',
      'What changed in the pipeline forecast this week?',
      'Two opportunities moved to December. The change affects timing, while their combined contract value is unchanged.',
    ],
    [
      'support',
      'Summarize the support queue',
      'Which issues should support review first?',
      'Start with the account lockouts. Billing questions are next, followed by the lower-priority connector requests.',
    ],
    [
      'access',
      'Review access requests',
      'Which teams are waiting on access?',
      'Design needs access to the research archive. The finance group is waiting for a reporting role in the billing workspace.',
    ],
    [
      'launch',
      'Check the launch calendar',
      'Which launch milestones are coming up?',
      'The release candidate is due on Thursday. Documentation review follows on Friday, ahead of the customer announcement.',
    ],
    [
      'vendors',
      'Compare vendor proposals',
      'How do the two support proposals differ?',
      'Both include weekday support. The second also includes weekend coverage and a named implementation contact.',
    ],
    [
      'planning',
      'Collect planning inputs',
      'What is missing from the quarterly planning packet?',
      'The hiring plan and security review are complete. Product still needs to add the infrastructure estimate.',
    ],
    [
      'research',
      'Synthesize customer research interviews across the international onboarding program',
      'What came up most often in the customer interviews?',
      'Most participants asked for quicker search and clearer ownership when a request moves between teams.',
    ],
    [
      'invoices',
      'Find overdue invoices',
      'Which invoices need a follow-up?',
      'Two invoices are awaiting purchase-order numbers. The account owners have the billing contacts and can follow up this week.',
    ],
    [
      'incident',
      'Prepare the incident recap',
      'Summarize what happened during the service interruption.',
      'A delayed queue slowed new jobs. The team drained the queue, restored normal processing, and added an alert for the same condition.',
    ],
    [
      'knowledge',
      'Organize the knowledge base',
      'Which documents should be consolidated?',
      'The onboarding checklist and setup guide repeat the same access instructions. Keep the instructions in the setup guide and link to them from the checklist.',
    ],
    [
      'board',
      'Draft the board update',
      'What belongs in the operations section?',
      'Include the hiring milestone, the support response trend, and the two upcoming customer launches. Each has a named owner and a reporting date.',
    ],
  ].map(([id, title, prompt, answer]) => ({
    id,
    title,
    turns: [
      {
        id,
        time: '9:15 AM',
        prompt: { text: prompt, attachments: [] },
        response: {
          state: 'complete' as const,
          duration: '6s',
          paragraphs: [{ text: answer }],
          steps: [],
          time: '9:15 AM',
        },
      },
    ],
  })),
]
const chat: ConversationData = {
  threads,
  references: [
    { group: 'Chats', items: threads.map(({ id, title }) => ({ id, name: title })) },
    { group: 'Dashboards', items: [{ id: 'activity', name: 'Workspace activity' }] },
    { group: 'Tables', items: [{ id: 'requests', name: 'Customer requests' }] },
    { group: 'Files', items: files.map(({ id, name }) => ({ id, name })) },
    { group: 'Knowledge bases', items: [{ id: 'onboarding', name: 'Onboarding guide' }] },
    { group: 'Workflows', items: [{ id: 'renewals', name: 'Renewal review' }] },
    { group: 'Logs', items: [{ id: 'last-run', name: 'Latest run' }] },
  ],
  draftAttachments: [],
}
const emptyHome: HomeData = {
  ...fullHome,
  connected: false,
  attention: [],
  email: [],
  calendar: { date: '2026-10-14', meetings: [] },
  ranges: fullHome.ranges.map((range) => ({
    ...range,
    points: range.points.map((point) => ({ ...point, value: 0 })),
  })),
}
const batch = Array.from({ length: 20 }, (_, i) => ({
  ...files[i % files.length],
  id: `file-${i}`,
  name: i < 3 ? files[i].name : `Review document ${i + 1}`,
}))
export const conversationScenarios: Record<Scenario, { home: HomeData; chat: ConversationData }> = {
  empty: { home: emptyHome, chat: { threads: [], references: [], draftAttachments: [] } },
  full: { home: { ...fullHome, references: chat.references }, chat },
  stress: {
    home: {
      ...fullHome,
      references: chat.references,
      attention: Array.from({ length: 12 }, (_, i) => ({
        ...fullHome.attention[i % 2],
        id: `review-${i}`,
        title: `Review international operating request ${i + 1} and coordinate the next steps`,
      })),
    },
    chat: {
      ...chat,
      draftAttachments: batch,
      threads: chat.threads.map((item, i) =>
        i === 0
          ? {
              ...item,
              title: 'Review the international customer renewal briefing',
              turns: Array.from({ length: 8 }, (_, j) => ({
                ...renewal,
                id: `history-${j}`,
                prompt: {
                  attachments: j === 7 ? batch : [],
                  text: Array.from({ length: 10 }, () => renewal.prompt.text).join(' '),
                },
              })),
            }
          : item
      ),
    },
  },
}
