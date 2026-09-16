import type { NavMenu } from '@/app/(landing)/components/navbar/components/nav-menu-chip/types'

/**
 * Sim's product system, grouped around the two questions an enterprise buyer
 * brings to the platform: how teams build agents and how the organization
 * operates them. The muted `Sim` prefix makes each module read as part of one
 * governed workspace instead of a collection of unrelated tools.
 */
export const PLATFORM_MENU: NavMenu = {
  label: 'Platform',
  eyebrow: 'The Sim platform',
  heading: 'One system for agent work',
  description:
    'Build, deploy, and govern agents with company context, shared data, and execution history in one place.',
  sections: [
    {
      label: 'Platform overview',
      items: [
        {
          title: 'Overview',
          description:
            'See how Sim’s products work together to build, run, and govern agent systems.',
          href: '/platform',
          preview: {
            kind: 'overview',
            eyebrow: 'Overview',
            title: 'One system for agent work',
            details: ['Knowledge', 'Workflows', 'Logs'],
          },
        },
        {
          brand: 'Sim',
          title: 'Enterprise',
          description: 'Control access, spend, data, and deployment across the workspace.',
          href: '/enterprise',
          preview: {
            kind: 'enterprise',
            eyebrow: 'Govern',
            title: 'Set the rules once',
            details: ['Workspace roles', 'Usage limits', 'Deployment controls'],
          },
        },
        {
          brand: 'Sim',
          title: 'Workflows',
          description: 'Design repeatable agent systems visually, through Chat, or with code.',
          href: '/workflows',
          preview: {
            kind: 'workflows',
            eyebrow: 'Build',
            title: 'Design agent logic visually',
            details: ['Trigger', 'Agent', 'Action'],
          },
        },
      ],
    },
    {
      label: 'Operations and control',
      items: [
        {
          brand: 'Sim',
          title: 'Knowledge Base',
          description: 'Ground every agent in trusted knowledge from across your company.',
          href: '/knowledge',
          preview: {
            kind: 'knowledge',
            eyebrow: 'Ground',
            title: 'Connect company knowledge',
            details: ['Notion', 'Google Drive', 'Confluence'],
          },
        },
        {
          brand: 'Sim',
          title: 'Files',
          description: 'Keep agent inputs, outputs, and shared artifacts organized in one place.',
          href: '/files',
          preview: {
            kind: 'files',
            eyebrow: 'Share',
            title: 'One file store for agents',
            details: ['research.pdf', 'brief.docx', 'accounts.csv'],
          },
        },
        {
          brand: 'Sim',
          title: 'Tables',
          description: 'Give agents structured data they can read and update while they work.',
          href: '/tables',
          preview: {
            kind: 'tables',
            eyebrow: 'Structure',
            title: 'Keep working data close',
            details: ['Company', 'Owner', 'Status'],
          },
        },
        {
          brand: 'Sim',
          title: 'Logs',
          description:
            'Trace every agent run block by block, including actions, cost, and failures.',
          href: '/logs',
          preview: {
            kind: 'logs',
            eyebrow: 'Observe',
            title: 'Trace every run block by block',
            details: ['Run started', 'Agent completed', 'Action completed'],
          },
        },
      ],
    },
  ],
}

/**
 * Learning and evaluation surfaces. Enterprise now lives with the platform
 * products, while Library fills the resource taxonomy with the existing
 * comparisons, how-tos, and roundups.
 */
export const RESOURCES_MENU: NavMenu = {
  label: 'Resources',
  eyebrow: 'Resources',
  heading: 'Learn, evaluate, and build with Sim',
  description:
    'Go from first workflow to production with technical references, product updates, and practical guidance.',
  sections: [
    {
      label: 'Build with Sim',
      items: [
        {
          title: 'Docs',
          description: 'Guides, SDKs, and API reference',
          href: 'https://docs.sim.ai',
          external: true,
          preview: {
            kind: 'docs',
            eyebrow: 'Documentation',
            title: 'Build with Sim',
            details: ['Quickstart', 'SDKs', 'API reference'],
          },
        },
        {
          title: 'Models',
          description: 'Compare supported AI models',
          href: '/models',
          preview: {
            kind: 'models',
            eyebrow: 'Models',
            title: 'Choose the right model',
            details: ['Providers', 'Capabilities', 'Pricing'],
          },
        },
        {
          title: 'Integrations',
          description: 'Connect apps, tools, and triggers',
          href: '/integrations',
          preview: {
            kind: 'integrations',
            eyebrow: 'Integrations',
            title: 'Connect the systems you use',
            details: ['Apps', 'Tools', 'Triggers'],
          },
        },
      ],
    },
    {
      label: 'Stay current',
      items: [
        {
          title: 'Changelog',
          description: 'See everything we just shipped',
          href: '/changelog',
          preview: {
            kind: 'changelog',
            eyebrow: 'Changelog',
            title: 'Follow product updates',
            details: ['New', 'Improved', 'Fixed'],
          },
        },
        {
          title: 'Blog',
          description: 'Read ideas, news, and deep dives',
          href: '/blog',
          preview: {
            kind: 'blog',
            eyebrow: 'Blog',
            title: 'Read the latest from Sim',
            details: ['Product', 'Engineering', 'Company'],
          },
        },
        {
          title: 'Library',
          description: 'Browse comparisons, how-tos, and roundups',
          href: '/library',
          preview: {
            kind: 'library',
            eyebrow: 'Library',
            title: 'Make informed AI decisions',
            details: ['Comparisons', 'How-tos', 'Roundups'],
          },
        },
      ],
    },
  ],
}

/**
 * The customers who build with Sim, each a card with the customer's mark on a
 * white placement. Each card opens its dedicated customer-story page.
 */
export const CUSTOMERS_MENU: NavMenu = {
  label: 'Customers',
  eyebrow: 'Customers',
  heading: 'Teams building with Sim',
  description: 'How enterprise teams build, govern, and operate AI agents with Sim.',
  layout: 'floating',
  marquee: 'customers',
  sections: [
    {
      label: 'Featured customers',
      items: [
        {
          title: 'Rivian',
          description:
            'One place to connect systems and build, govern, and operate AI agents across Rivian.',
          href: '/customers/rivian',
          card: {
            imageSrc: '/landing/logos/rivian-vw.svg',
            imageAlt: 'Rivian | Volkswagen Group Technologies',
            aspect: 10.72,
            height: 22,
            tone: 'dark',
            background: { src: '/landing/customers/rivian-trail.jpg' },
          },
          preview: {
            kind: 'resource',
            eyebrow: 'Customer story',
            title: 'Rivian builds with Sim',
            details: ['Enterprise systems', 'Governed agents', 'One workspace'],
          },
        },
        {
          title: 'eXp Realty',
          description:
            'Complex real estate operations turned into governed AI workflows that scale across eXp Realty.',
          href: '/customers/exp-realty',
          card: {
            imageSrc: '/landing/logos/exp-realty.svg',
            imageAlt: 'eXp Realty',
            aspect: 1.84,
            height: 44,
            tone: 'dark',
            background: { src: '/landing/customers/exp-beach-house.jpg' },
          },
          preview: {
            kind: 'resource',
            eyebrow: 'Customer story',
            title: 'eXp Realty builds with Sim',
            details: ['Real estate operations', 'Governed workflows', 'Scale'],
          },
        },
      ],
    },
  ],
}

/**
 * Navbar mega-menus in trigger order - shared by desktop and mobile nav (the
 * desktop bar maps this list; mobile nav mirrors its sections). Platform leads
 * with products and governance, Customers follows with the teams building on
 * it, and Resources closes with learning surfaces.
 */
export const NAV_MENUS = [PLATFORM_MENU, CUSTOMERS_MENU, RESOURCES_MENU] as const
