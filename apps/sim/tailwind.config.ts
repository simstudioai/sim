import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
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
        gradient: {
          primary: 'hsl(var(--gradient-primary))',
          secondary: 'hsl(var(--gradient-secondary))',
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
        'brand-inset': 'var(--shadow-brand-inset)',
        card: 'var(--shadow-card)',
      },
      dropShadow: {
        tour: [
          '0 0 0.5px color-mix(in srgb, var(--text-primary) 10%, transparent)',
          '0 4px 12px rgba(0,0,0,0.1)',
        ],
      },
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
        'thinking-block': {
          '0%, 100%': { opacity: '0.15' },
          '30%, 55%': { opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(40px)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-in-bottom': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'tour-tooltip-in': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'collapsible-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-collapsible-content-height)' },
        },
        'collapsible-up': {
          from: { height: 'var(--radix-collapsible-content-height)' },
          to: { height: '0' },
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
        'thinking-block': 'thinking-block 1.6s ease-in-out infinite',
        'slide-in-right': 'slide-in-right 350ms ease-out forwards',
        'slide-in-bottom': 'slide-in-bottom 400ms cubic-bezier(0.16, 1, 0.3, 1)',
        'tour-tooltip-in': 'tour-tooltip-in 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'collapsible-down': 'collapsible-down 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        'collapsible-up': 'collapsible-up 300ms cubic-bezier(0.4, 0, 0.2, 1)',
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
