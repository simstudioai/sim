interface AuthDividerProps {
  label: string
}

/**
 * The "Or continue with" rule separating the email/password form from the
 * social/SSO options. Light tokens only: a `--border` hairline with the label
 * knocked out over the `--bg` canvas in `--text-muted`.
 */
export function AuthDivider({ label }: AuthDividerProps) {
  return (
    <div className='relative'>
      <div className='absolute inset-0 flex items-center'>
        <div className='w-full border-[var(--border)] border-t' />
      </div>
      <div className='relative flex justify-center'>
        <span className='bg-[var(--bg)] px-4 text-[var(--text-muted)] text-sm'>{label}</span>
      </div>
    </div>
  )
}
