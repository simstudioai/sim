import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
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
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'slide-down': {
          '0%': { transform: 'translate(-50%, -100%)', opacity: '0' },
          '100%': { transform: 'translate(-50%, 0)', opacity: '1' },
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
            opacity: '0',
            transform: 'translateY(0)',
          },
          '100%': {
            opacity: '1',
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
      },
      animation: {
        'slide-down': 'slide-down 0.3s ease-out',
        'notification-slide': 'notification-slide 0.3s ease-out forwards',
        'notification-fade-out': 'notification-fade-out 0.2s ease-out forwards',
        'fade-up': 'fade-up 0.5s ease-out forwards',
        'rocket-pulse': 'rocket-pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config
