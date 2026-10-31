import { createClient } from '@supabase/supabase-js';

// GANTI NILAI DI BAWAH INI DENGAN URL DAN ANON KEY PROJECT SUPABASE ANDA
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || 'https://GANTI_DENGAN_URL_PROJECT_ANDA.supabase.co';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || 'GANTI_DENGAN_ANON_KEY_ANDA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);