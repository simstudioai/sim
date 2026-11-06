import type { Page, Route } from '@playwright/test'
import type {
  HomeWidgetAccount,
  OrganizationHomeCalendar,
  OrganizationHomeEmail,
} from '@/lib/api/contracts/organization-home'
import { CONNECTED, GRANTS, NAMED_LINKS, ORGANIZATION_ID } from '@/scripts/org-redesign-e2e/fixture'

export const FOUR_WAY_MEETINGS = ['Board prep', 'Budget review', 'Hiring loop', 'Vendor call']
/** Adjacent meetings, a pair side by side with one shorter than its slot, then a four-way overlap. */
const BUSY_DAY_EVENTS = [
  { title: 'Morning planning', start: '09:30', end: '10:00', people: [{ name: 'Ada Lovelace' }] },
  {
    title: 'Sim search feedback review',
    start: '10:00',
    end: '10:30',
    people: [{ name: 'Ada Lovelace' }, { name: 'Alan Turing' }, { name: 'Edith Clarke' }],
  },
  { title: 'Design check-in', start: '10:00', end: '10:20', people: [{ name: 'Alan Turing' }] },
  { title: 'Roadmap session', start: '11:00', end: '12:00', people: [{ name: 'Edith Clarke' }] },
  ...FOUR_WAY_MEETINGS.map((title) => ({ title, start: '13:00', end: '14:00', people: [] })),
]

export const EMAIL_THREAD = (): OrganizationHomeEmail['threads'][number] => ({
  id: 'thread-1',
  credentialId: GRANTS.gmail.credentialId,
  sender: 'Grace Hopper',
  subject: 'Parts recall notice',
  excerpt: 'The draft is ready for review',
  receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
  messageCount: 3,
  url: 'https://mail.google.com/mail/u/0/#inbox/thread-1',
})

/** Answers a stubbed read with a body checked against the route's contract at compile time. */
export function fulfillContract<T>(route: Route, json: T) {
  return route.fulfill({ json })
}

/** Replies the same Google stand-in every test sees for a viewer's connected accounts. */
export async function stubConnectedHome(page: Page) {
  const today = new Date().toISOString().slice(0, 10)
  const account = (credentialId: string): HomeWidgetAccount => ({
    credentialId,
    displayName: CONNECTED.email,
    state: 'ready',
  })
  await page.route(`**/api/organizations/${ORGANIZATION_ID}/home/email**`, (route) =>
    fulfillContract<OrganizationHomeEmail>(route, {
      accounts: [account(GRANTS.gmail.credentialId)],
      threads: [EMAIL_THREAD()],
    })
  )
  await page.route(`**/api/organizations/${ORGANIZATION_ID}/home/calendar**`, (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? today
    return fulfillContract<OrganizationHomeCalendar>(route, {
      accounts: [account(GRANTS['google-calendar'].credentialId)],
      window: { startAt: `${date}T00:00:00.000Z`, endAt: `${date}T23:59:59.000Z` },
      events: [
        {
          id: `event-${date}`,
          credentialId: GRANTS['google-calendar'].credentialId,
          title: `Standup ${date}`,
          allDay: false,
          startAt: `${date}T15:00:00.000Z`,
          endAt: `${date}T15:30:00.000Z`,
          people: [{ name: 'Grace Hopper' }],
        },
        ...BUSY_DAY_EVENTS.map(({ title, start, end, people }) => ({
          id: `${title}-${date}`,
          credentialId: GRANTS['google-calendar'].credentialId,
          title,
          allDay: false,
          startAt: `${date}T${start}:00.000Z`,
          endAt: `${date}T${end}:00.000Z`,
          url: `https://calendar.google.com/event/${encodeURIComponent(title)}`,
          people,
        })),
      ],
    })
  })
}

export const searchResult = (query: string) => ({
  success: true,
  data: {
    query,
    retrieval: { status: 'complete', timedOutLegs: [] },
    results: [
      {
        documentId: 'bulletin-1',
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: 'Google Drive',
        documentName: 'Service bulletin',
        sourceUrl: NAMED_LINKS.handbook.url,
        connectorType: 'google_drive',
        sourceModifiedAt: new Date().toISOString(),
        author: 'Grace Hopper',
        content: `The bulletin about ${query} is ready.`,
        chunkIndex: 0,
        similarity: 1,
      },
      {
        documentId: 'bulletin-2',
        knowledgeBaseId: 'kb-1',
        knowledgeBaseName: 'Confluence',
        documentName: 'Recall playbook',
        sourceUrl: 'https://wiki.example.com/recall',
        connectorType: 'confluence',
        sourceModifiedAt: new Date().toISOString(),
        author: 'Grace Hopper',
        content: `The playbook about ${query}.`,
        chunkIndex: 0,
        similarity: 0.9,
      },
    ],
  },
})

export async function stubSearch(page: Page) {
  await page.route('**/api/knowledge/search', async (route) => {
    const body = route.request().postDataJSON()
    await route.fulfill({ json: searchResult(body.query) })
  })
}
