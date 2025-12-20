/**
 * Creates a Basic Authentication header from username and password
 * @param username ServiceNow username
 * @param password ServiceNow password
 * @returns Base64 encoded Basic Auth header value
 */
export function createBasicAuthHeader(username: string, password: string): string {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64')
  return `Basic ${credentials}`
}
