'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import PasswordAuth from './password-auth'

const adminThemeStyle = `
  :root {
    --primary: 264 100% 60%;
  }
  
  .dark {
    --primary: 264 100% 60%;
  }
`

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <PasswordAuth>
      {/* Add the custom theme styles */}
      <style jsx global>
        {adminThemeStyle}
      </style>

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 md:px-8 py-6">
        {/* Admin Nav */}
        <div className="mb-6 flex items-center space-x-4 border-b pb-4 overflow-x-auto scrollbar-hide">
          <Link
            href="/admin"
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              pathname === '/admin'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/admin/waitlist"
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              pathname.startsWith('/admin/waitlist')
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Waitlist
          </Link>
          <Link
            href="/admin/users"
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              pathname.startsWith('/admin/users')
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Users
          </Link>
          <Link
            href="/admin/subscriptions"
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              pathname.startsWith('/admin/subscriptions')
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            Subscriptions
          </Link>
        </div>

        {children}
      </div>
    </PasswordAuth>
  )
}
