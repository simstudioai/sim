/**
 * A Twilio API key and its secret as one value, `SK<32 hex>:<secret>`: the exact username and
 * password Twilio's HTTP Basic auth takes for an API key. Twilio documents a key SID as `SK` and
 * 32 hex characters; the auth tokens it issues are 32 hex characters with no colon (the Account
 * resource documents no pattern), so no issued auth token takes this shape.
 */
const TWILIO_API_KEY_PAIR = /^SK[0-9a-fA-F]{32}:\S+$/

/** Whether a Twilio credential value is an API key pair rather than an account auth token. */
export function isTwilioApiKeyPair(authToken: string): boolean {
  return TWILIO_API_KEY_PAIR.test(authToken)
}

/**
 * The Basic Authorization header for a Twilio REST request on `accountSid`'s URLs. An auth token
 * authenticates as the account itself (`accountSid:authToken`); an API key pair authenticates as
 * the key (`SKxxx:secret`), while the URL still names the account.
 */
export function twilioAuthorization(accountSid: string, authToken: string): string {
  const credentials = isTwilioApiKeyPair(authToken) ? authToken : `${accountSid}:${authToken}`
  return `Basic ${Buffer.from(credentials).toString('base64')}`
}
