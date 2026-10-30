import { AuthButton, type AuthButtonProps } from '@sim/auth-ui'

interface AuthSubmitButtonProps extends AuthButtonProps {
  loadingLabel: string
}
export function AuthSubmitButton({ type = 'submit', ...props }: AuthSubmitButtonProps) {
  return <AuthButton {...props} type={type} variant='primary' fullWidth />
}
