import { createClient } from '@supabase/supabase-js'

// =========================================================================
// ИНИЦИАЛИЗАЦИЯ КЛИЕНТА SUPABASE ДЛЯ ПРОЕКТА «BEAUTY HUB»
// =========================================================================

// Базовый адрес проекта Supabase (очищенный от невидимых символов)
const SUPABASE_URL = 'https://hwjkdvozvmrdowxcguih.supabase.co'

// Публичный анонимный ключ для безопасного доступа с фронтенда
const SUPABASE_ANON_KEY = 'sb_publishable_4VYlk8in8G88eTrIYEbcLQ__S8RGmtn'

/**
 * Создаем и экспортируем единый экземпляр клиента Supabase.
 * Он будет использоваться во всем приложении для авторизации,
 * чтения и записи данных в таблицы (users, services, schedule, bookings).
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)