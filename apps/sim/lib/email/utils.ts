export const validateAndNormalizeEmail = (
  email: string
): { isValid: boolean; normalized: string } => {
  const normalized = email.trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return {
    isValid: emailRegex.test(normalized),
    normalized,
  }
}
