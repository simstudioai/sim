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
      },
      fontSize: {
        xs: '11px',
        small: '13px', // Override default 14px to 13px
        base: '15px', // Override default 16px to 15px
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
        base: '450',
        medium: '480',
        semibold: '550',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      transitionProperty: {
        width: 'width',
        left: 'left',
        padding: 'padding',
      },
      keyframes: {
        'slide-down': {
          '0%': {
            transform: 'translate(-50%, -100%)',
            opacity: '0',
          },
          '100%': {
            transform: 'translate(-50%, 0)',
            opacity: '1',
          },
        },
        'notification-slide': {
          '0%': {
            opacity: '0',
            transform: 'translateY(-100%)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'notification-fade-out': {
          '0%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
          '100%': {
            opacity: '0',
            transform: 'translateY(0)',
          },
        },
        'fade-up': {
          '0%': {
            opacity: '0',
            transform: 'translateY(10px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'rocket-pulse': {
          '0%, 100%': {
            opacity: '1',
          },
          '50%': {
            opacity: '0.7',
          },
        },
        'run-glow': {
          '0%, 100%': {
            filter: 'opacity(1)',
          },
          '50%': {
            filter: 'opacity(0.7)',
          },
        },
        'caret-blink': {
          '0%,70%,100%': {
            opacity: '1',
          },
          '20%,50%': {
            opacity: '0',
          },
        },
        'pulse-slow': {
          '0%, 100%': {
            opacity: '1',
          },
          '50%': {
            opacity: '0.7',
          },
        },
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
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
        'pulse-ring': {
          '0%': {
            boxShadow: '0 0 0 0 hsl(var(--border))',
          },
          '50%': {
            boxShadow: '0 0 0 8px hsl(var(--border))',
          },
          '100%': {
            boxShadow: '0 0 0 0 hsl(var(--border))',
          },
        },
        'code-shimmer': {
          '0%': {
            transform: 'translateX(-100%)',
          },
          '100%': {
            transform: 'translateX(100%)',
          },
        },
        orbit: {
          '0%': {
            transform:
              'rotate(calc(var(--angle) * 1deg)) translateY(calc(var(--radius) * 1px)) rotate(calc(var(--angle) * -1deg))',
          },
          '100%': {
            transform:
              'rotate(calc(var(--angle) * 1deg + 360deg)) translateY(calc(var(--radius) * 1px)) rotate(calc((var(--angle) * -1deg) - 360deg))',
          },
        },
        marquee: {
          from: {
            transform: 'translateX(0)',
          },
          to: {
            transform: 'translateX(calc(-100% - var(--gap)))',
          },
        },
        'marquee-vertical': {
          from: {
            transform: 'translateY(0)',
          },
          to: {
            transform: 'translateY(calc(-100% - var(--gap)))',
          },
        },
        'fade-in': {
          from: {
            opacity: '0',
          },
          to: {
            opacity: '1',
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
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
        'notification-slide': 'notification-slide 0.3s ease-out forwards',
        'notification-fade-out': 'notification-fade-out 0.2s ease-out forwards',
        'fade-up': 'fade-up 0.5s ease-out forwards',
        'rocket-pulse': 'rocket-pulse 1.5s ease-in-out infinite',
        'run-glow': 'run-glow 2s ease-in-out infinite',
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'pulse-slow': 'pulse-slow 3s ease-in-out infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-left': 'slide-left 80s linear infinite',
        'slide-right': 'slide-right 80s linear infinite',
        'dash-animation': 'dash-animation 1.5s linear infinite',
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'code-shimmer': 'code-shimmer 1.5s infinite',
        orbit: 'orbit calc(var(--duration, 2) * 1s) linear infinite',
        marquee: 'marquee var(--duration) infinite linear',
        'marquee-vertical': 'marquee-vertical var(--duration) linear infinite',
        'fade-in': 'fade-in 0.3s ease-in-out forwards',
        'placeholder-pulse': 'placeholder-pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
