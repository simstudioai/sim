import { expect, type Page } from '@playwright/test'
import { generateId } from '@sim/utils/id'
import { organizationId } from '@/platform/checks/live/session'
import { withLiveDatabase } from '@/platform/checks/live/support/database'

/** The sidebar's Chats section. */
const chatList = (page: Page) => page.getByRole('region', { name: 'Chats', exact: true })

/**
 * A chat's sidebar link, paging the Chats section with See more until it lists: the section shows a
 * page at a time by last activity, and chats the other live checks start sort above the seeded ones.
 */
export async function revealChat(page: Page, title: string) {
  const chats = chatList(page)
  const link = chats.getByRole('link', { name: title, exact: true })
  await expect(async () => {
    if ((await link.count()) === 0)
      await chats.getByRole('button', { name: 'See more', exact: true }).click({ timeout: 1_000 })
    await expect(link).toBeVisible({ timeout: 1_000 })
  }).toPass()
  return link
}

/** Opens a chat row's options menu once its row lists: the button appears on hover. */
export async function openChatMenu(page: Page, title: string) {
  await (await revealChat(page, title)).hover()
  await chatList(page)
    .getByRole('button', { name: `Actions for ${title}`, exact: true })
    .click()
}

/** A chat made for one check, which {@link withSeededChat} deletes afterwards. */
export interface SeededChat {
  id: string
  title: string
}

interface SeededChatOptions {
  /** Whose chat it is. */
  email: string
  mode?: 'agent' | 'assistant'
  /** In Recently deleted rather than the sidebar. */
  deleted?: boolean
}

/**
 * Runs `check` with a read chat of its own in the seeded organization, holding one exchange, and
 * deletes it afterwards whatever happened: pinning, marking or restoring it changes nothing another
 * check or a rerun reads. Its title carries the run's time, so it names one row.
 */
export async function withSeededChat<T>(
  { email, mode = 'agent', deleted = false }: SeededChatOptions,
  check: (chat: SeededChat) => Promise<T>
): Promise<T> {
  const chat = { id: generateId(), title: `Live chat ${Date.now()}` }
  await withLiveDatabase((sql) =>
    sql.begin(async (tx) => {
      await tx`insert into copilot_chats (id, user_id, organization_id, type, title, config,
          last_seen_at, deleted_at)
        values (${chat.id}, (select id from "user" where email = ${email}), ${organizationId()},
          'mothership', ${chat.title}, ${tx.json({ conversationMode: mode })},
          now() + interval '1 minute', ${deleted ? new Date() : null})`
      for (const [seq, role, content] of [
        [1, 'user', `About ${chat.title}`],
        [2, 'assistant', `Here is what I found about ${chat.title}.`],
      ] as const) {
        const messageId = `${chat.id}-${role}`
        await tx`insert into copilot_messages (chat_id, message_id, role, seq, content)
          values (${chat.id}, ${messageId}, ${role}, ${seq},
            ${tx.json({ id: messageId, role, content, timestamp: new Date().toISOString() })})`
      }
    })
  )
  try {
    return await check(chat)
  } finally {
    await withLiveDatabase((sql) => sql`delete from copilot_chats where id = ${chat.id}`)
  }
}

/**
 * Deletes the chats `email` started in the seeded organization since `since` (the database's own
 * clock), so a check that sends turns leaves the Chats section and Recently deleted as it found them.
 */
export async function removeChatsStartedSince(email: string, since: Date) {
  await withLiveDatabase(
    (sql) => sql`delete from copilot_chats
      where user_id = (select id from "user" where email = ${email})
        and organization_id = ${organizationId()} and created_at >= ${since}`
  )
}

/** The database's clock, which {@link removeChatsStartedSince} compares against. */
export function databaseNow() {
  return withLiveDatabase(async (sql) => {
    const [{ now }] = await sql<{ now: Date }[]>`select now() as now`
    return now
  })
}
