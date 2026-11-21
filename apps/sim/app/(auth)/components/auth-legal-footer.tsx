import { AuthLegal } from '@sim/auth-ui'

interface AuthLegalFooterProps {
  action: string
}
export function AuthLegalFooter({ action }: AuthLegalFooterProps) {
  return <AuthLegal action={action} />
}
