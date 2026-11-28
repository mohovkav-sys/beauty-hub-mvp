import { createClient } from '@supabase/supabase-js'

// Инициализация клиента Supabase для проекта «Beauty Hub»
const DEFAULT_SUPABASE_URL = 'https://hwjkdvozvmrdowxcguih.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_4VYlk8in8G88eTrIYEbcLQ__S8RGmtn'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)