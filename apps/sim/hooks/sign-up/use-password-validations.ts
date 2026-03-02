import { useTranslations } from 'next-intl'

export function usePasswordValidations() {
  const t = useTranslations()

  return {
    minLength: { regex: /.{8,}/, message: t('sign_up.validations.password_min_8_character') },
    uppercase: {
      regex: /(?=.*?[A-Z])/,
      message: t('sign_up.validations.password_min_1_uppercase_letter'),
    },
    lowercase: {
      regex: /(?=.*?[a-z])/,
      message: t('sign_up.validations.password_min_1_lowercase_letter'),
    },
    number: { regex: /(?=.*?[0-9])/, message: t('sign_up.validations.password_min_1_number') },
    special: {
      regex: /(?=.*?[#?!@$%^&*-])/,
      message: t('sign_up.validations.password_min_1_special_character'),
    },
  }
}
