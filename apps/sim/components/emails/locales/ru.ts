/**
 * Русские темы email-писем.
 * Используется когда локаль пользователя — 'ru'.
 */
import type { EmailSubjectType } from '@/components/emails/subjects'
import { getBrandConfig } from '@/ee/whitelabeling'

export function getEmailSubjectRu(type: EmailSubjectType): string {
  const brandName = getBrandConfig().name

  const subjects: Record<EmailSubjectType, string> = {
    'sign-in': `Вход в ${brandName}`,
    'email-verification': `Подтверждение email для ${brandName}`,
    'change-email': `Подтверждение нового email для ${brandName}`,
    'forget-password': `Сброс пароля ${brandName}`,
    'reset-password': `Сброс пароля ${brandName}`,
    'existing-account': `Попытка регистрации с вашим email на ${brandName}`,
    invitation: `Вас пригласили в команду на ${brandName}`,
    'batch-invitation': `Вас пригласили в команду и воркспейсы на ${brandName}`,
    'workspace-added': `Вас добавили в воркспейс на ${brandName}`,
    'polling-group-invitation': `Приглашение в группу email-опроса на ${brandName}`,
    'help-confirmation': 'Ваш запрос получен',
    'enterprise-subscription': `Ваш план Enterprise активирован на ${brandName}`,
    'usage-threshold': `Вы приближаетесь к месячному лимиту на ${brandName}`,
    'free-tier-upgrade': `Вы использовали 80% бесплатных кредитов на ${brandName}`,
    'plan-welcome-pro': `Ваш план Pro активирован на ${brandName}`,
    'plan-welcome-team': `Ваш план Team активирован на ${brandName}`,
    'credit-purchase': `Кредиты добавлены на ваш аккаунт ${brandName}`,
    'abandoned-checkout': 'Быстрый вопрос',
    'free-tier-exhausted': `У вас закончились бесплатные кредиты на ${brandName}`,
    'onboarding-followup': `Быстрый вопрос о ${brandName}`,
    welcome: `Добро пожаловать в ${brandName}`,
  }

  return subjects[type] ?? brandName
}
