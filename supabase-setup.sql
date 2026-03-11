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
