import { AuthButton, type AuthButtonProps } from '@sim/emcn-auth/button'

interface AuthSubmitButtonProps extends AuthButtonProps {
  loadingLabel: string
}
export function AuthSubmitButton({ type = 'submit', ...props }: AuthSubmitButtonProps) {
  return <AuthButton {...props} type={type} variant='primary' fullWidth />
}
