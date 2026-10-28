-- Dispatch queue backend — Supabase Postgres schema.
-- Run this once in the Supabase SQL editor (project dashboard → SQL → New query).
-- Auth: the API uses the service_role key, which bypasses RLS entirely,
-- so we enable RLS with NO policies (only service_role can touch these tables).

create table if not exists tasks (
  id         text        primary key,
  status     text        not null default 'pending'
             check (status in ('pending', 'claimed', 'done', 'failed')),
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id         text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists notices (
  key        text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists heartbeats (
  worker     text        primary key,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock tables to service_role only (service_role bypasses RLS; anon gets nothing).
alter table tasks      enable row level security;
alter table messages   enable row level security;
alter table notices    enable row level security;
alter table heartbeats enable row level security;
-- (intentionally no policies: only the service_role key can read/write)

-- Hot-path index: listing tasks by status.
create index if not exists tasks_status_idx on tasks (status);
