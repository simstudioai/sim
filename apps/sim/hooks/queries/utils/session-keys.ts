/**
 * Query keys for the canonical session. Not a `'use client'` module, so a server prefetch can seed
 * the entry the client session query reads without importing the auth client.
 */
export const sessionKeys = {
  all: ['session'] as const,
  detail: () => [...sessionKeys.all, 'detail'] as const,
}
