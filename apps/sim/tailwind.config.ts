import type { Config } from 'tailwindcss'

export default {
  // Nesting-aware dark variant: `dark:` utilities apply inside a `.dark` subtree
  // UNLESS they sit inside a nested `.light` island. The landing page pins
  // itself light (a `.light` wrapper) while the visitor's `<html>` may carry
  // `.dark`; without this exclusion, `dark:` utilities on emcn components (e.g.
  // the `primary` chip's `dark:bg-white`) would leak through and render
  // white-on-white. `:where()` keeps specificity equal to base utilities so the
  // normal (non-island) dark-mode cascade is unchanged.
  darkMode: ['variant', '&:where(.dark, .dark *):not(:where(.light, .light *))'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/emcn/src/**/*.{js,ts,jsx,tsx}',
    '../../packages/workflow-renderer/src/**/*.{js,ts,jsx,tsx}',
    '!./app/node_modules/**',
    '!**/node_modules/**',
  ],
  theme: {
    extend: {
      fontFamily: {
        season: ['var(--font-season)'],
        body: [
          'ui-sans-serif',
          '-apple-system',
          'system-ui',
          'Segoe UI',
          'Helvetica',
          'Apple Color Emoji',
          'Arial',
          'sans-serif',
          'Segoe UI Emoji',
          'Segoe UI Symbol',
        ],
        mono: [
          'var(--font-martian-mono, ui-monospace)',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      fontSize: {
        micro: '10px',
        xs: '11px',
        caption: '12px',
        small: '13px',
        base: '15px',
        md: '16px',
      },
      spacing: {
        '4.5': '18px',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        gray: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
      },
      fontWeight: {
        base: 'var(--font-weight-base)',
        medium: 'var(--font-weight-medium)',
        semibold: 'var(--font-weight-semibold)',
      },
      borderRadius: {
        xs: '2px',
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
      },
      boxShadow: {
        subtle: 'var(--shadow-subtle)',
        medium: 'var(--shadow-medium)',
        overlay: 'var(--shadow-overlay)',
        kbd: 'var(--shadow-kbd)',
        'kbd-sm': 'var(--shadow-kbd-sm)',
        card: 'var(--shadow-card)',
      },
      dropShadow: {},
      transitionProperty: {
        width: 'width',
        left: 'left',
        padding: 'padding',
      },
      keyframes: {
        'caret-blink': {
          '0%,70%,100%': {
            opacity: '1',
          },
          '20%,50%': {
            opacity: '0',
          },
        },
        'slide-left': {
          '0%': {
            transform: 'translateX(0)',
          },
          '100%': {
            transform: 'translateX(-50%)',
          },
        },
        'slide-right': {
          '0%': {
            transform: 'translateX(-50%)',
          },
          '100%': {
            transform: 'translateX(0)',
          },
        },
        'dash-animation': {
          from: {
            strokeDashoffset: '0',
          },
          to: {
            strokeDashoffset: '-24',
          },
        },
        'placeholder-pulse': {
          '0%, 100%': {
            opacity: '0.5',
          },
          '50%': {
            opacity: '0.8',
          },
        },
        'ring-pulse': {
          '0%, 100%': {
            'box-shadow': '0 0 0 1.5px var(--border-success)',
          },
          '50%': {
            'box-shadow': '0 0 0 4px var(--border-success)',
          },
        },
        'stream-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(40px)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-bottom': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--radix-collapsible-content-height)' },
          to: { height: '0' },
        },
        'hero-stage-fade': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'hero-cursor-press': {
          '0%, 100%': { transform: 'scale(1)' },
          '45%': { transform: 'scale(0.8)' },
        },
        'hero-modal-in': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'hero-kb-content-morph': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'hero-file-drop': {
          from: { opacity: '0', transform: 'translateY(-44px) scale(0.96)' },
          '60%': { opacity: '1' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'hero-node-pop': {
          from: { opacity: '0', transform: 'scale(0)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'hero-graph-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.22)' },
        },
        'hero-edge-draw': {
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'slide-left': 'slide-left 80s linear infinite',
        'slide-right': 'slide-right 80s linear infinite',
        'dash-animation': 'dash-animation 1.5s linear infinite',
        'placeholder-pulse': 'placeholder-pulse 1.5s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 1.5s ease-in-out infinite',
        'stream-fade-in': 'stream-fade-in 300ms ease-out forwards',
        'stream-fade-in-delayed': 'stream-fade-in 300ms ease-out 1.5s forwards',
        'slide-in-right': 'slide-in-right 350ms ease-out forwards',
        'slide-in-bottom': 'slide-in-bottom 400ms cubic-bezier(0.16, 1, 0.3, 1)',
        'collapsible-down': 'collapsible-down 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'collapsible-up': 'collapsible-up 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'hero-stage-fade': 'hero-stage-fade 420ms cubic-bezier(0.23, 1, 0.32, 1) both',
        'hero-cursor-press': 'hero-cursor-press 340ms cubic-bezier(0.23, 1, 0.32, 1)',
        'hero-modal-in': 'hero-modal-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'hero-kb-content-morph':
          'hero-kb-content-morph 420ms cubic-bezier(0.22, 1, 0.36, 1) 260ms forwards',
        'hero-file-drop': 'hero-file-drop 480ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'hero-node-pop': 'hero-node-pop 440ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'hero-edge-draw': 'hero-edge-draw 520ms ease-out forwards',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
    require('tailwindcss/plugin')(
      ({ addVariant }: { addVariant: (name: string, definition: string) => void }) => {
        addVariant('hover-hover', '@media (hover: hover) and (pointer: fine) { &:hover }')
      }
    ),
  ],
} satisfies Config
