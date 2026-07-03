import { AuthShell } from '@/app/(auth)/components'

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>
}
