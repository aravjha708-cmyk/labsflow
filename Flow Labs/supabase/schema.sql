-- =========================================================
-- FLOW LABS — SUPABASE DATABASE SCHEMA & RLS POLICIES
-- Paste this entire script into your Supabase SQL Editor & Run
-- =========================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- 1. USER PROFILES TABLE (Users & Credential Management)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password TEXT NOT NULL DEFAULT 'flow123',
  account_password TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'reseller', 'user')) DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'ultra',
  total_credits INT NOT NULL DEFAULT 25000, -- 25000 or 45000 credits
  used_credits INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration columns for existing database
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS password TEXT DEFAULT 'flow123';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_password TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'ultra';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_credits INT DEFAULT 25000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS used_credits INT DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- =========================================================
-- 2. SYSTEM SESSIONS TABLE (API Management & Header Strings)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.system_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_cookies TEXT NOT NULL DEFAULT '',
  api_token TEXT DEFAULT '',
  target_url TEXT DEFAULT 'https://labs.google',
  target_default_path TEXT DEFAULT '/fx/tools/flow',
  gate_password TEXT DEFAULT 'flow123',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure a master active session row exists
INSERT INTO public.system_sessions (id, session_cookies, api_token, target_url, target_default_path, gate_password, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '',
  '',
  'https://labs.google',
  '/fx/tools/flow',
  'flow123',
  true
)
ON CONFLICT (id) DO UPDATE SET
  target_url = EXCLUDED.target_url,
  target_default_path = EXCLUDED.target_default_path,
  updated_at = NOW();

-- =========================================================
-- 3. SYSTEM SETTINGS TABLE (Maintenance Mode & System Config)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Initial Maintenance Mode setting
INSERT INTO public.system_settings (key, value)
VALUES ('maintenance_mode', '{"is_updating": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =========================================================
-- 4. VIDEO GENERATION HISTORY TABLE
-- =========================================================
CREATE TABLE IF NOT EXISTS public.generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT DEFAULT 'Veo 3.1 by Labs Flow',
  aspect_ratio TEXT DEFAULT '16:9',
  credits_spent INT DEFAULT 0,
  status TEXT CHECK (status IN ('queued', 'processing', 'completed', 'failed')) DEFAULT 'completed',
  video_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================
-- 5. ENABLE ROW LEVEL SECURITY (RLS) & OPEN POLICIES
-- =========================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read/write on profiles" ON public.profiles;
CREATE POLICY "Allow public read/write on profiles" ON public.profiles FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read/write on system_sessions" ON public.system_sessions;
CREATE POLICY "Allow public read/write on system_sessions" ON public.system_sessions FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read/write on system_settings" ON public.system_settings;
CREATE POLICY "Allow public read/write on system_settings" ON public.system_settings FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read/write on generation_history" ON public.generation_history;
CREATE POLICY "Allow public read/write on generation_history" ON public.generation_history FOR ALL USING (true);