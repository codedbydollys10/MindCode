-- Run this in the Supabase SQL editor for your project.
-- It creates your app tables and enables RLS so the frontend (anon key) can
-- safely write the authenticated user's row into public.users.

-- USERS -------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text unique not null,
  headline text,
  location text,
  about text,
  preferred_language text,
  difficulty_bias text,
  github_url text,
  linkedin_url text,
  photo_data text,
  created_at timestamptz default now()
);

alter table public.users add column if not exists headline text;
alter table public.users add column if not exists location text;
alter table public.users add column if not exists about text;
alter table public.users add column if not exists preferred_language text;
alter table public.users add column if not exists difficulty_bias text;
alter table public.users add column if not exists github_url text;
alter table public.users add column if not exists linkedin_url text;
alter table public.users add column if not exists photo_data text;

alter table public.users enable row level security;
drop policy if exists "users insert own row" on public.users;
create policy "users insert own row" on public.users
  for insert with check (auth.uid() = id);
drop policy if exists "users select own row" on public.users;
create policy "users select own row" on public.users
  for select using (auth.uid() = id);
drop policy if exists "users update own row" on public.users;
create policy "users update own row" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- SKILL TESTS -------------------------------------------------------
create table if not exists public.skill_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  language text,
  question text not null,
  topic text,
  difficulty text check (difficulty in ('low','medium','high')),
  starter_code text,
  expected_output text,
  test_cases jsonb,
  created_at timestamptz default now()
);

alter table public.skill_tests add column if not exists language text;

-- SUBMISSIONS -------------------------------------------------------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references public.skill_tests(id) on delete set null,
  user_id uuid references public.users(id) on delete cascade,
  code text,
  language text,
  output text,
  error text,
  passed boolean,
  execution_time float,
  created_at timestamptz default now()
);

-- KEYSTROKE LOGS ----------------------------------------------------
create table if not exists public.keystroke_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  timestamp timestamptz default now(),
  typing_speed float,
  pause_duration float,
  backspace_count int,
  cursor_position int,
  code_snapshot text,
  burst_insert_detected boolean default false,
  is_paste_event boolean default false
);


-- FACIAL DATA -------------------------------------------------------
create table if not exists public.emotion_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  timestamp timestamptz default now(),
  emotion text,
  confidence float
);

-- REPORTS -----------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  problem_breakdown_score float,
  debugging_score float,
  focus_score float,
  planning_score float,
  flexibility_score float,
  heatmap_data jsonb,
  summary text,
  created_at timestamptz default now()
);

-- RECOMMENDATIONS ---------------------------------------------------
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  weak_areas text[],
  recommended_topics text[],
  recommended_questions jsonb,
  ai_feedback text,
  created_at timestamptz default now()
);

-- Minimal RLS for read-only access to tests. Adjust as needed.
alter table public.skill_tests enable row level security;
alter table public.submissions enable row level security;
alter table public.keystroke_logs enable row level security;
alter table public.emotion_logs enable row level security;
alter table public.reports enable row level security;
alter table public.recommendations enable row level security;

-- Let authenticated users see tests and their own work. Expand to collaborators if needed.
drop policy if exists "skill_tests readable" on public.skill_tests;
create policy "skill_tests readable" on public.skill_tests
  for select using (true);

drop policy if exists "submissions own" on public.submissions;
create policy "submissions own" on public.submissions
  for select using (auth.uid() = user_id);
drop policy if exists "keystrokes own" on public.keystroke_logs;
create policy "keystrokes own" on public.keystroke_logs
  for select using (auth.uid() = user_id);
drop policy if exists "emotion own" on public.emotion_logs;
create policy "emotion own" on public.emotion_logs
  for select using (auth.uid() = user_id);
drop policy if exists "reports own" on public.reports;
create policy "reports own" on public.reports
  for select using (auth.uid() = user_id);
drop policy if exists "recommendations own" on public.recommendations;
create policy "recommendations own" on public.recommendations
  for select using (auth.uid() = user_id);

-- For inserts from the frontend, allow only the owner to write their rows.
drop policy if exists "submissions insert own" on public.submissions;
create policy "submissions insert own" on public.submissions
  for insert with check (auth.uid() = user_id);
drop policy if exists "submissions insert service" on public.submissions;
create policy "submissions insert service" on public.submissions
  for insert with check (true);
drop policy if exists "keystrokes insert own" on public.keystroke_logs;
create policy "keystrokes insert own" on public.keystroke_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "keystrokes insert service" on public.keystroke_logs;
create policy "keystrokes insert service" on public.keystroke_logs
  for insert with check (true);
drop policy if exists "emotion insert own" on public.emotion_logs;
create policy "emotion insert own" on public.emotion_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists "emotion insert service" on public.emotion_logs;
create policy "emotion insert service" on public.emotion_logs
  for insert with check (true);
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports
  for insert with check (auth.uid() = user_id);
drop policy if exists "reports insert service" on public.reports;
create policy "reports insert service" on public.reports
  for insert with check (true);
drop policy if exists "recommendations insert own" on public.recommendations;
create policy "recommendations insert own" on public.recommendations
  for insert with check (auth.uid() = user_id);
drop policy if exists "recommendations insert service" on public.recommendations;
create policy "recommendations insert service" on public.recommendations
  for insert with check (true);

-- ═══════════════════════════════════════════════════════════════
-- BEHAVIORAL INTELLIGENCE ENGINE — SCHEMA ADDITIONS
-- Run these in Supabase SQL editor after the base schema
-- ═══════════════════════════════════════════════════════════════

-- Make test_id nullable for submissions and keystroke_logs to allow graceful fallback
alter table public.submissions drop constraint if exists submissions_test_id_fkey;
alter table public.submissions add constraint submissions_test_id_fkey 
  foreign key (test_id) references public.skill_tests(id) on delete set null;

alter table public.keystroke_logs drop constraint if exists keystroke_logs_test_id_fkey;
alter table public.keystroke_logs add constraint keystroke_logs_test_id_fkey 
  foreign key (test_id) references public.skill_tests(id) on delete set null;

-- KEYSTROKE LOGS: add line_number + word_count if missing
alter table public.keystroke_logs add column if not exists line_number integer;
alter table public.keystroke_logs add column if not exists word_count integer;
alter table public.keystroke_logs add column if not exists action_type text;
alter table public.keystroke_logs add column if not exists code_length integer;
alter table public.keystroke_logs add column if not exists prev_line_number integer;
alter table public.keystroke_logs add column if not exists line_time_ms float;
alter table public.keystroke_logs add column if not exists idle_ms float;
alter table public.keystroke_logs add column if not exists key_pressed text;
alter table public.keystroke_logs add column if not exists paste_detected boolean default false;
alter table public.keystroke_logs add column if not exists pasted_char_count integer;
alter table public.keystroke_logs add column if not exists pasted_line_count integer;
alter table public.keystroke_logs add column if not exists typing_speed float;
alter table public.keystroke_logs add column if not exists cursor_position integer;
alter table public.keystroke_logs add column if not exists sudden_code_jump boolean default false;

-- BEHAVIOR BLOCKS TABLE — Enhanced behavioral intelligence
-- Tracks comprehensive behavioral patterns at the block/chunk level
create table if not exists public.behavior_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  timestamp timestamptz default now(),
  
  -- Keystroke metrics
  keystroke_count integer default 0,
  backspace_count integer default 0,
  pause_duration_ms float default 0,
  typing_speed_avg float,
  
  -- Copy-paste detection
  paste_detected boolean default false,
  pasted_char_count integer default 0,
  pasted_line_count integer default 0,
  
  -- Idle time & hesitation
  idle_ms float default 0,
  hesitation_count integer default 0,
  
  -- Error patterns
  error_count integer default 0,
  error_recovery_time_ms float,
  
  -- Code rewrite patterns
  line_rewrites integer default 0,
  code_rewrite_count integer default 0,
  deletion_bursts integer default 0,
  
  -- Context
  code_snapshot text,
  block_duration_ms float,
  focus_level float,
  is_completing boolean default false
);

-- Performance indexes on behavior_blocks
create index if not exists idx_behavior_blocks_user_test on public.behavior_blocks(user_id, test_id);
create index if not exists idx_behavior_blocks_timestamp on public.behavior_blocks(timestamp);

-- RLS Policies for behavior_blocks
alter table public.behavior_blocks enable row level security;
drop policy if exists "behavior_blocks own" on public.behavior_blocks;
create policy "behavior_blocks own" on public.behavior_blocks
  for select using (auth.uid() = user_id);
drop policy if exists "behavior_blocks insert own" on public.behavior_blocks;
create policy "behavior_blocks insert own" on public.behavior_blocks
  for insert with check (auth.uid() = user_id);
drop policy if exists "behavior_blocks insert service" on public.behavior_blocks;
create policy "behavior_blocks insert service" on public.behavior_blocks
  for insert with check (true);
alter table public.keystroke_logs add column if not exists line_time_ms float;
alter table public.keystroke_logs add column if not exists idle_ms float;
alter table public.keystroke_logs add column if not exists error_count integer default 0;
alter table public.keystroke_logs add column if not exists paste_detected boolean default false;
alter table public.keystroke_logs add column if not exists pasted_char_count integer default 0;
alter table public.keystroke_logs add column if not exists pasted_line_count integer default 0;
alter table public.keystroke_logs add column if not exists sudden_code_jump boolean default false;

-- KEYSTROKE LOGS: add behavior block metrics to consolidate all keystroke data
alter table public.keystroke_logs add column if not exists keystroke_count integer;
alter table public.keystroke_logs add column if not exists pause_duration_ms float;
alter table public.keystroke_logs add column if not exists typing_speed_avg float;
alter table public.keystroke_logs add column if not exists hesitation_count integer;
alter table public.keystroke_logs add column if not exists error_recovery_time_ms float;
alter table public.keystroke_logs add column if not exists line_rewrites integer;
alter table public.keystroke_logs add column if not exists code_rewrite_count integer;
alter table public.keystroke_logs add column if not exists deletion_bursts integer;
alter table public.keystroke_logs add column if not exists block_duration_ms float;
alter table public.keystroke_logs add column if not exists focus_level float;
alter table public.keystroke_logs add column if not exists is_completing boolean default false;

-- EMOTION LOGS: add gaze_state if missing
alter table public.emotion_logs add column if not exists gaze_state text;

-- REPORTS: ensure all cognitive score columns exist
alter table public.reports add column if not exists problem_breakdown_score float;
alter table public.reports add column if not exists debugging_score float;
alter table public.reports add column if not exists focus_score float;
alter table public.reports add column if not exists planning_score float;
alter table public.reports add column if not exists flexibility_score float;
alter table public.reports add column if not exists heatmap_data jsonb;
alter table public.reports add column if not exists summary text;

-- RECOMMENDATIONS: store AI-generated recommendations
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  test_id uuid references public.skill_tests(id) on delete set null,
  weak_areas jsonb,
  recommended_topics jsonb,
  suggested_questions jsonb,
  ai_feedback text,
  study_plan jsonb,
  created_at timestamptz default now()
);

-- Prevent duplicate recommendations per user+test
alter table public.recommendations add column if not exists study_plan jsonb;
alter table public.recommendations add column if not exists suggested_questions jsonb;

-- Unique constraint for upsert
create unique index if not exists recommendations_user_test_unique 
  on public.recommendations (user_id, test_id) 
  where test_id is not null;

-- RLS for reports (candidates can see their own, recruiters see all)
alter table public.reports enable row level security;
drop policy if exists "reports select own" on public.reports;
create policy "reports select own" on public.reports
  for select using (auth.uid() = user_id);
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports
  for insert with check (auth.uid() = user_id);
drop policy if exists "reports update own" on public.reports;
create policy "reports update own" on public.reports
  for update using (auth.uid() = user_id);

-- RLS for recommendations
alter table public.recommendations enable row level security;
drop policy if exists "recs select own" on public.recommendations;
create policy "recs select own" on public.recommendations
  for select using (auth.uid() = user_id);
drop policy if exists "recs insert own" on public.recommendations;
create policy "recs insert own" on public.recommendations
  for insert with check (auth.uid() = user_id);
drop policy if exists "recs update own" on public.recommendations;
create policy "recs update own" on public.recommendations
  for update using (auth.uid() = user_id);

-- Performance indexes
create index if not exists idx_keystroke_user_test on public.keystroke_logs (user_id, test_id);
create index if not exists idx_emotion_user_test on public.emotion_logs (user_id, test_id);
create index if not exists idx_reports_user on public.reports (user_id, created_at desc);
create index if not exists idx_submissions_user_test on public.submissions (user_id, test_id);
create index if not exists idx_recs_user on public.recommendations (user_id, created_at desc);

-- COLLABORATIVE CODING ----------------------------------------------
-- The backend uses the Supabase service role after verifying each user's
-- Supabase access token and room membership. Browser clients have no direct
-- access to these tables.
create table if not exists public.collaboration_rooms (
  id uuid primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  invite_hash text not null unique,
  language text not null check (language in ('python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust')),
  content_state text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collaboration_room_members (
  room_id uuid not null references public.collaboration_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists idx_collaboration_members_user
  on public.collaboration_room_members (user_id, room_id);

alter table public.collaboration_rooms enable row level security;
alter table public.collaboration_room_members enable row level security;
revoke all on public.collaboration_rooms, public.collaboration_room_members from anon, authenticated;
grant select, insert, update, delete on public.collaboration_rooms, public.collaboration_room_members to service_role;
