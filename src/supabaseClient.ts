import { createClient } from '@supabase/supabase-js';

// GANTI NILAI DI BAWAH INI DENGAN URL DAN ANON KEY PROJECT SUPABASE ANDA
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || 'https://rdcttmskvviifrbkpoaa.supabase.co';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJkY3R0bXNrdnZpaWZyYmtwb2FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNzA3NDIsImV4cCI6MjEwODk0Njc0Mn0.hfBCHtsJCmD9PNko3oiNFboXIOZd6Sp4cFG8JOU5ix4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
