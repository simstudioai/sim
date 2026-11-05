import type { Page } from '@playwright/test'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use real seeded members`)
  return value
}

export async function signIn(page: Page, email: string, password: string, target: string) {
  await page.goto(target)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
