import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Конфигурация сборщика Vite для проекта Beauty Hub
export default defineConfig({
  plugins: [react()],
  // Настройки локального сервера разработки
  server: {
    // Явно задаем 127.0.0.1 (или '0.0.0.0' для доступа с телефона по Wi-Fi),
    // чтобы избежать конфликтов маршрутизации localhost в Windows
    host: '127.0.0.1',
    // Фиксируем стандартный порт приложения
    port: 5173,
  },
})