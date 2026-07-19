import type { NavMenu } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

/**
 * The Platform menu - Sim's modules. Six items in a three-column grid. Each
 * description names the outcome the module unlocks for your agents.
 */
export const PLATFORM_MENU: NavMenu = {
  label: 'Platform',
  items: [
    {
      title: 'Workflows',
      description: 'Design agent logic visually',
      href: '/workflows',
    },
    {
      title: 'Knowledge Base',
      description: 'Give agents memory of your data',
      href: '/knowledge',
    },
    {
      title: 'Tables',
      description: 'Power agents with structured data',
      href: '/tables',
    },
    {
      title: 'Files',
      description: 'One file store for team and agents',
      href: '/files',
    },
    {
      title: 'Scheduled Tasks',
      description: 'Run agents on a cadence',
      href: '/scheduled-tasks',
    },
    {
      title: 'Logs',
      description: 'Trace every agent decision',
      href: '/logs',
    },
  ],
}

/**
 * The Resources menu - learning and reference surfaces plus the Enterprise
 * page. Six items in a three-column grid. Docs is the one off-site link.
 */
export const RESOURCES_MENU: NavMenu = {
  label: 'Resources',
  items: [
    {
      title: 'Docs',
      description: 'Guides and API reference',
      href: 'https://docs.sim.ai',
      external: true,
    },
    {
      title: 'Blog',
      description: 'Ideas, news, and deep dives',
      href: '/blog',
    },
    {
      title: 'Enterprise',
      description: 'Govern AI agents at enterprise scale',
      href: '/enterprise',
    },
    {
      title: 'Changelog',
      description: 'Everything we just shipped',
      href: '/changelog',
    },
    {
      title: 'Models',
      description: 'Run on every major LLM',
      href: '/models',
    },
    {
      title: 'Integrations',
      description: 'Connect 1,000+ apps and tools',
      href: '/integrations',
    },
  ],
}

/**
 * The Solutions menu - agent use cases by team, Sales first. Six items in a
 * three-column grid.
 */
export const SOLUTIONS_MENU: NavMenu = {
  label: 'Solutions',
  items: [
    {
      title: 'Sales',
      description: 'Automate outreach and CRM upkeep',
      href: '/solutions/sales',
    },
    {
      title: 'Engineering',
      description: 'Let agents handle the busywork',
      href: '/solutions/engineering',
    },
    {
      title: 'IT',
      description: 'Resolve tickets and access requests',
      href: '/solutions/it',
    },
    {
      title: 'Compliance',
      description: 'Stay audit-ready around the clock',
      href: '/solutions/compliance',
    },
    {
      title: 'Finance',
      description: 'Close the books faster',
      href: '/solutions/finance',
    },
    {
      title: 'HR',
      description: 'Onboard and support every employee',
      href: '/solutions/hr',
    },
  ],
}

/**
 * Navbar mega-menus in trigger order - shared by desktop and mobile nav (the
 * desktop bar maps this list; mobile nav derives its visible sections from
 * these labels). Platform leads with the product modules, Solutions follows
 * with the per-team pages, and Resources closes with learning surfaces.
 */
export const NAV_MENUS = [PLATFORM_MENU, SOLUTIONS_MENU, RESOURCES_MENU] as const
