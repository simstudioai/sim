import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Discord returns the bot's own user for a valid bot token and 401 otherwise. */
export const validateDiscordServiceAccount = tokenCheckValidator({
  serviceLabel: 'Discord',
  request: ({ apiToken }) => ({
    url: 'https://discord.com/api/v10/users/@me',
    headers: { Authorization: `Bot ${apiToken}`, Accept: 'application/json' },
  }),
})
