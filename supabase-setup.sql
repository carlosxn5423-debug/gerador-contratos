-- Execute no SQL Editor do Supabase (https://app.supabase.com → SQL Editor)

create table if not exists submissions (
  id         text primary key,
  tipo       text not null,
  fields     jsonb not null default '{}',
  criado_em  timestamptz not null default now(),
  status     text not null default 'pendente'
);

-- Índice para ordenação por data
create index if not exists idx_submissions_criado_em on submissions (criado_em desc);

-- Permissão de leitura/escrita para a chave anon (usada pelo app)
alter table submissions enable row level security;

create policy "anon_insert" on submissions for insert to anon with check (true);
create policy "anon_select" on submissions for select to anon using (true);

-- ─────────────────────────────────────────────────────────────────
-- Tabela de candidatos (triagem via Typeform)
-- ─────────────────────────────────────────────────────────────────
create table if not exists candidates (
  id               text primary key,
  form_id          text not null,
  form_title       text,
  name             text,
  email            text,
  phone            text,
  score            integer,
  score_breakdown  jsonb default '{}',
  decision         text,
  salary_raw       text,
  video_url        text,
  text_answers     jsonb default '[]',
  submitted_at     timestamptz,
  status           text default 'pendente',
  updated_at       timestamptz default now()
);

create index if not exists idx_candidates_form_id   on candidates (form_id);
create index if not exists idx_candidates_score     on candidates (score desc);
create index if not exists idx_candidates_submitted on candidates (submitted_at desc);

alter table candidates enable row level security;
create policy "anon_insert_candidates" on candidates for insert to anon with check (true);
create policy "anon_select_candidates" on candidates for select to anon using (true);
create policy "anon_update_candidates" on candidates for update to anon using (true);
