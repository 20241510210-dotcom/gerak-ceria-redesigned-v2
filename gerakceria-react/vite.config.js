import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/gerak-ceria-redesigned-v2/',
  plugins: [react()],
})