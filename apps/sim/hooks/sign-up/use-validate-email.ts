import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { useTranslations } from 'next-intl'

export function useValidateEmail() {
  const t = useTranslations()

  const validateEmailField = (emailValue: string): string[] => {
    const errors: string[] = []

    if (!emailValue || !emailValue.trim()) {
      errors.push(t('sign_up.validations.email_required'))
      return errors
    }

    const validation = quickValidateEmail(emailValue.trim().toLowerCase())
    if (!validation.isValid) {
      errors.push(validation.reason || t('sign_up.validations.email_invalid'))
    }

    return errors
  }

  return validateEmailField
}
