-- Piso 3ºB · cola de voces (se pega UNA vez en Supabase > SQL Editor > Run)
create table if not exists public.voz_jobs (
  key text primary key,
  who text, mood text, alto boolean default false, text text,
  status text not null default 'pending',   -- pending | working | done | error | hb
  audio_path text, dur real, error text, worker text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.voz_jobs enable row level security;
drop policy if exists "voz_jobs_todo" on public.voz_jobs;
create policy "voz_jobs_todo" on public.voz_jobs for all to anon using (true) with check (true);

insert into storage.buckets (id, name, public) values ('voz', 'voz', true) on conflict (id) do nothing;
drop policy if exists "voz_leer" on storage.objects;
drop policy if exists "voz_subir" on storage.objects;
drop policy if exists "voz_cambiar" on storage.objects;
drop policy if exists "voz_borrar" on storage.objects;
create policy "voz_leer"   on storage.objects for select to anon using (bucket_id = 'voz');
create policy "voz_subir"  on storage.objects for insert to anon with check (bucket_id = 'voz');
create policy "voz_cambiar" on storage.objects for update to anon using (bucket_id = 'voz');
create policy "voz_borrar" on storage.objects for delete to anon using (bucket_id = 'voz');
