import { expect, type Page } from '@playwright/test'

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
