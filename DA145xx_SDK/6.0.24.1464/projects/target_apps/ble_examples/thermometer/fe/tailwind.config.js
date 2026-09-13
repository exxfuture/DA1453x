/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces Variable"', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Public Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Primitive ramps (Pine/Sand/Ember): identical hex in both themes —
        // "non-semantic UI chrome" per the design spec. Components reach
        // light/dark contrast via explicit `dark:` variants (see the
        // Button/Input/Table state tables), not a CSS-var flip.
        primary: {
          50: '#EFF9F5',
          100: '#D7F0E7',
          200: '#AFE1D0',
          300: '#7FCBB4',
          400: '#4FAF97',
          500: '#2F9481',
          600: '#1F7A6A',
          700: '#186257',
          800: '#144E46',
          900: '#123F39',
          950: '#082621',
        },
        sand: {
          0: '#FAF9F6',
          50: '#F5F3EE',
          100: '#EDEAE2',
          200: '#DEDACD',
          300: '#C7C1AF',
          400: '#A79E88',
          500: '#8A8069',
          600: '#6E6552',
          700: '#564F41',
          800: '#3D3830',
          900: '#27231F',
          950: '#17140F',
        },
        ember: {
          50: '#FFF4EC',
          100: '#FFE4CC',
          200: '#FFC896',
          300: '#FFA75F',
          400: '#F98A3C',
          500: '#ED6F1F',
          600: '#CC5814',
          700: '#B84E10',
          800: '#7C3714',
          900: '#5C2B12',
        },
        // Garnet: only the steps needed for the destructive Button's solid
        // fill (default/hover/active) — the tinted danger.* role token
        // (used for banners/badges) covers everything else.
        garnet: {
          50: '#FDEDEA',
          600: '#B8341F',
          700: '#A62F1C',
          800: '#7D2315',
        },
        success: {
          text: 'rgb(var(--color-success-text) / <alpha-value>)',
          tint: 'rgb(var(--color-success-tint) / <alpha-value>)',
          border: 'rgb(var(--color-success-border) / <alpha-value>)',
        },
        warning: {
          text: 'rgb(var(--color-warning-text) / <alpha-value>)',
          tint: 'rgb(var(--color-warning-tint) / <alpha-value>)',
          border: 'rgb(var(--color-warning-border) / <alpha-value>)',
        },
        danger: {
          text: 'rgb(var(--color-danger-text) / <alpha-value>)',
          tint: 'rgb(var(--color-danger-tint) / <alpha-value>)',
          border: 'rgb(var(--color-danger-border) / <alpha-value>)',
        },
        info: {
          text: 'rgb(var(--color-info-text) / <alpha-value>)',
          tint: 'rgb(var(--color-info-tint) / <alpha-value>)',
          border: 'rgb(var(--color-info-border) / <alpha-value>)',
        },
        temp: {
          low: {
            text: 'rgb(var(--color-temp-low-text) / <alpha-value>)',
            tint: 'rgb(var(--color-temp-low-tint) / <alpha-value>)',
            border: 'rgb(var(--color-temp-low-border) / <alpha-value>)',
          },
          normal: {
            text: 'rgb(var(--color-temp-normal-text) / <alpha-value>)',
            tint: 'rgb(var(--color-temp-normal-tint) / <alpha-value>)',
            border: 'rgb(var(--color-temp-normal-border) / <alpha-value>)',
          },
          elevated: {
            text: 'rgb(var(--color-temp-elevated-text) / <alpha-value>)',
            tint: 'rgb(var(--color-temp-elevated-tint) / <alpha-value>)',
            border: 'rgb(var(--color-temp-elevated-border) / <alpha-value>)',
          },
          fever: {
            text: 'rgb(var(--color-temp-fever-text) / <alpha-value>)',
            tint: 'rgb(var(--color-temp-fever-tint) / <alpha-value>)',
            border: 'rgb(var(--color-temp-fever-border) / <alpha-value>)',
          },
          highFever: {
            text: 'rgb(var(--color-temp-high-fever-text) / <alpha-value>)',
            tint: 'rgb(var(--color-temp-high-fever-tint) / <alpha-value>)',
            border: 'rgb(var(--color-temp-high-fever-border) / <alpha-value>)',
          },
        },
        page: 'rgb(var(--color-page) / <alpha-value>)',
        surface: {
          1: 'rgb(var(--color-surface-1) / <alpha-value>)',
          2: 'rgb(var(--color-surface-2) / <alpha-value>)',
          3: 'rgb(var(--color-surface-3) / <alpha-value>)',
        },
        border: {
          hairline: 'rgb(var(--color-border) / <alpha-value>)',
        },
        ink: {
          primary: 'rgb(var(--color-ink-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-ink-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
        },
      },
      fontSize: {
        'hero-1': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'hero-2': ['3rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        display: ['2rem', { lineHeight: '1.15', fontWeight: '600' }],
        h1: ['1.75rem', { lineHeight: '1.2' }],
        h2: ['1.375rem', { lineHeight: '1.25' }],
        h3: ['1.125rem', { lineHeight: '1.3' }],
        'body-lg': ['1rem', { lineHeight: '1.5' }],
        body: ['0.875rem', { lineHeight: '1.5' }],
        caption: ['0.8125rem', { lineHeight: '1.4' }],
        label: ['0.75rem', { lineHeight: '1.3', letterSpacing: '0.04em' }],
        'mono-sm': ['0.8125rem', { lineHeight: '1.4' }],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
        xl: '24px',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        focus: 'var(--shadow-focus)',
      },
      spacing: {
        touch: '2.75rem',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
      },
    },
  },
  plugins: [],
};
