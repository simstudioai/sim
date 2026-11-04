import 'server-only'
import type {
  ChatAttachment,
  ChatTurn,
  ConversationData,
  HomeData,
} from '@/platform/design-system/models/conversation'
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
  workspaces: [
    {
      id: 'customer',
      title: 'Customer operations',
      detail: 'Handling onboarding and support',
      meta: 'Running',
      indicator: 'I014',
      icon: 'I025',
    },
    {
      id: 'revenue',
      title: 'Revenue operations',
      detail: 'Renewal brief ready for review',
      meta: 'Review',
      icon: 'I025',
    },
    {
      id: 'finance',
      title: 'Finance',
      detail: 'Invoices reconciled this morning',
      meta: 'Up to date',
      icon: 'I025',
    },
  ],
  email: [
    {
      id: 'checklist',
      sender: 'Nina Patel',
      avatar: nina.src,
      count: 3,
      subject: 'Updated onboarding checklist',
      excerpt: 'I’ve added the new handoff steps.',
      received: '12m ago',
    },
    {
      id: 'q4',
      sender: 'Alex Chen',
      avatar: alex.src,
      count: 2,
      subject: 'Q4 customer review',
      excerpt: 'Can you review the agenda before Friday?',
      received: '38m ago',
    },
    {
      id: 'invoice',
      sender: 'Maya Ross',
      avatar: maya.src,
      subject: 'Invoice approval for October',
      excerpt: 'Thanks, everything is ready to go.',
      received: '1d ago',
    },
  ],
  calendar: {
    date: '2026-10-13',
    times: ['10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM'],
    now: '11:24 AM',
    nowMinute: 84,
    meetings: [
      {
        id: 'customer',
        title: 'Customer operations review',
        time: '10:30–11:15 AM',
        startMinute: 30,
        duration: 45,
        people,
      },
      {
        id: 'product',
        title: 'Product & revenue sync',
        time: '12:00–12:45 PM',
        startMinute: 120,
        duration: 45,
        people: people.slice(1, 3),
      },
    ],
  },
}
const renewal: ChatTurn = {
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
    paragraphs: [
      'The renewal is in good shape. There are three things worth addressing before Friday’s call.',
      'Confirm the rollout owner. The brief names Maya, but the latest account note assigns the next phase to Alex. Clarify who will own the handoff.',
      'Resolve the reporting request. Aster asked for a weekly summary of failed runs. The request is still open and should be included in the renewal plan.',
      'Align on the expansion timing. The proposal assumes a November launch; the account team is planning for December.',
      'I’d open the call with ownership and timing, then agree on a date for the reporting update.',
    ],
    steps: [
      {
        id: 'read',
        name: 'Read renewal-brief.pdf',
        time: '1.2s',
        input: '{"file":"renewal-brief.pdf","pages":"1–12"}',
        output: '{"account":"Aster Labs","rollout_owner":"Maya Ross","expansion":"November"}',
      },
      {
        id: 'ownership',
        name: 'Search account notes  ownership',
        time: '0.8s',
        input: '{"query":"ownership"}',
        output: 'Alex Chen will coordinate the next phase.',
      },
      {
        id: 'timing',
        name: 'Search account notes  rollout timing',
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
}
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
        response: entry && {
          ...entry,
          state,
          paragraphs:
            state === 'stopped'
              ? [
                  'I found an ownership mismatch in the renewal brief.',
                  'The brief lists Maya Ross, while the latest notes name Alex Chen as the owner for the next phase.',
                ]
              : [],
        },
      },
    ],
  }
}
const chat: ConversationData = {
  threads: [
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
    thread(
      'q4-planning',
      'Q4 planning',
      'Prepare the operating plan for next quarter.',
      'stopped',
      [files[2]]
    ),
  ],
  references: [
    { group: 'Chats', items: [{ id: 'weekly-review', name: 'Review the renewal brief' }] },
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
  workspaces: [],
  email: [],
  calendar: { date: '2026-10-14', times: [], meetings: [] },
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
