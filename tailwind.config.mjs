/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        madain: {
          gold: '#9C8830',
          goldDark: '#78682A',
          bronze: '#6E5E33',
          straw: '#D5C68A',
          shaft: '#242424',
          tundora: '#444444',
          abbey: '#49494A',
          boulder: '#7A7A7A',
          gallery: '#EDEDED',
        },
      },
      fontFamily: {
        sans: ['Lato', 'system-ui', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
        arabic: ['Tajawal', 'Lato', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(90deg, #78682A 0%, #9C8830 100%)',
        'gold-gradient-v': 'linear-gradient(180deg, #78682A 0%, #9C8830 100%)',
        'footer-gradient': 'linear-gradient(180deg, #6E5E33 0%, #9C8830 100%)',
      },
      letterSpacing: {
        widest2: '0.28125em',
      },
      maxWidth: {
        container: '1140px',
      },
    },
  },
  plugins: [],
};
