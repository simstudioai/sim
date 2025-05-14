import InviteError from './invite-error'

// Generate this page on-demand instead of at build time
export const dynamic = 'force-dynamic'

export default function InviteErrorPage() {
  return <InviteError />
}
