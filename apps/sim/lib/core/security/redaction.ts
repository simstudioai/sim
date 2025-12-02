/**
 * Recursively redacts API keys in an object
 * @param obj The object to redact API keys from
 * @returns A new object with API keys redacted
 */
export const redactApiKeys = (obj: any): any => {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(redactApiKeys)
  }

  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (
      key.toLowerCase() === 'apikey' ||
      key.toLowerCase() === 'api_key' ||
      key.toLowerCase() === 'access_token' ||
      /\bsecret\b/i.test(key.toLowerCase()) ||
      /\bpassword\b/i.test(key.toLowerCase())
    ) {
      result[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactApiKeys(value)
    } else {
      result[key] = value
    }
  }

  return result
}
