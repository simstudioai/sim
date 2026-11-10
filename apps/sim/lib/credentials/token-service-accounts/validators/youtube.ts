import { tokenCheckValidator } from '@/lib/credentials/token-service-accounts/validators/http'

/** Listing video categories costs one quota unit; Google answers 400/403 for an invalid or restricted key. */
export const validateYouTubeServiceAccount = tokenCheckValidator({
  serviceLabel: 'YouTube',
  request: ({ apiToken }) => ({
    url: `https://www.googleapis.com/youtube/v3/videoCategories?part=id&regionCode=US&key=${encodeURIComponent(apiToken)}`,
    headers: { Accept: 'application/json' },
  }),
})
