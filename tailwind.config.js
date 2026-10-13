/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        wa: {
          green: '#00a884',
          greenDark: '#008069',
          bg: '#f0f2f5',
          chatbg: '#efeae2',
          out: '#d9fdd3',
          night: '#111b21',
          panel: '#202c33',
          chatNight: '#0b141a',
          outNight: '#005c4b',
          inNight: '#202c33',
          line: '#e9edef',
          lineNight: '#2a3942',
        },
      },
    },
  },
  plugins: [],
}
