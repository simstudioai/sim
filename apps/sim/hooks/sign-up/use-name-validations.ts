import { useTranslations } from 'next-intl'

export function useNameValidations() {
  const t = useTranslations()

  return {
    required: {
      test: (value: string) => Boolean(value && typeof value === 'string'),
      message: t('sign_up.validations.name_required'),
    },
    notEmpty: {
      test: (value: string) => value.trim().length > 0,
      message: t('sign_up.validations.name_cannot_be_empty'),
    },
    validCharacters: {
      regex: /^[\p{L}\s\-']+$/u,
      message: t('sign_up.validations.name_invalid_format'),
    },
    noConsecutiveSpaces: {
      regex: /^(?!.*\s\s).*$/,
      message: t('sign_up.validations.name_cannot_contain_spaces'),
    },
  }
}
