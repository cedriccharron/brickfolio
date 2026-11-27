-- Brickfolio — schéma Supabase.
-- À coller tel quel dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans danger (il ne supprime aucune donnée).
--
-- Comptes autorisés (toi, et éventuellement ton/ta partenaire) :
--   1. Authentication > Users > Add user > Create new user : e-mail + mot de passe, cocher « Auto Confirm User ».
--   2. SQL Editor : insert into public.owners (email) values ('adresse@exemple.be');   (en minuscules)

-- ---------- Tables ----------------------------------------------------------

create table if not exists public.owners (
  email text primary key check (email = lower(email))
);

create table if not exists public.purchases (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  set_no      text not null,                         -- numéro BrickLink, ex. 75192-1
  condition   text not null default 'N' check (condition in ('N', 'U')),  -- neuf / occasion
  qty         int  not null default 1 check (qty > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0),  -- prix payé par boîte (€)
  fees        numeric(10,2) not null default 0,     -- frais de port, etc. (total)
  bought_on   date not null,
  shop        text,
  notes       text,
  sold_price  numeric(10,2),                         -- prix de vente total (net), null = encore détenu
  sold_on     date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists purchases_owner on public.purchases (owner);

-- Fiches catalogue (cache BrickLink), écrites par la fonction « bricklink ».
create table if not exists public.sets (
  set_no      text primary key,
  name        text not null,
  year        int,
  image_url   text,
  category_id int,
  updated_at  timestamptz not null default now()
);

-- Relevés de prix (un par set, état et jour), écrits par la fonction « bricklink ».
create table if not exists public.prices (
  id          bigserial primary key,
  set_no      text not null,
  condition   text not null check (condition in ('N', 'U')),
  fetched_on  date not null default current_date,
  fetched_at  timestamptz not null default now(),
  currency    text not null default 'EUR',
  region      text,
  avg_sold    numeric(10,2),   -- moyenne des ventes des 6 derniers mois (pondérée par quantité)
  min_sold    numeric(10,2),
  max_sold    numeric(10,2),
  qty_sold    int,
  avg_stock   numeric(10,2),   -- moyenne des annonces en cours
  min_stock   numeric(10,2),
  qty_stock   int,
  unique (set_no, condition, fetched_on)
);

-- Valeurs encodées à la main (estimation personnelle, BrickEconomy, 2ememain…), propres à chaque compte.
create table if not exists public.manual_values (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  set_no      text not null,
  condition   text not null default 'N' check (condition in ('N', 'U')),
  valued_on   date not null default current_date,
  unit_value  numeric(10,2) not null check (unit_value >= 0),  -- valeur d'une boîte (€)
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists manual_values_owner on public.manual_values (owner);

-- Journal des relevés.
create table if not exists public.runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           int,
  failed       int,
  message      text
);

-- ---------- Droits -----------------------------------------------------------

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owners where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_owner() to authenticated;

alter table public.owners    enable row level security;
alter table public.purchases enable row level security;
alter table public.sets      enable row level security;
alter table public.prices    enable row level security;
alter table public.runs      enable row level security;
alter table public.manual_values enable row level security;

-- Chaque compte autorisé ne voit et ne modifie que ses propres achats.
drop policy if exists purchases_rw on public.purchases;
create policy purchases_rw on public.purchases for all to authenticated
  using (owner = auth.uid() and public.is_owner())
  with check (owner = auth.uid() and public.is_owner());

drop policy if exists manual_values_rw on public.manual_values;
create policy manual_values_rw on public.manual_values for all to authenticated
  using (owner = auth.uid() and public.is_owner())
  with check (owner = auth.uid() and public.is_owner());

-- Catalogue, prix et journal : lecture seule pour les comptes autorisés (écriture par la fonction, clé service).
drop policy if exists sets_read on public.sets;
create policy sets_read on public.sets for select to authenticated using (public.is_owner());
drop policy if exists prices_read on public.prices;
create policy prices_read on public.prices for select to authenticated using (public.is_owner());
drop policy if exists runs_read on public.runs;
create policy runs_read on public.runs for select to authenticated using (public.is_owner());

-- Date de mise à jour automatique.
create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists purchases_touch on public.purchases;
create trigger purchases_touch before update on public.purchases for each row execute function public.touch();

-- ---------- Nom du set choisi par l'utilisateur (v0.5.1) ----------------------
-- Rempli par la lecture de facture ou à la main ; sert tant que le catalogue BrickLink n'a pas la fiche.
alter table public.purchases add column if not exists name text;

-- ---------- Factures (v0.3) ----------------------------------------------------
-- Une facture (PDF ou photo) par achat, rangée dans le bucket privé « brickfolio-factures »
-- sous <id du compte>/<id de l'achat>/<fichier>. Chacun ne voit que les siennes.
alter table public.purchases add column if not exists invoice_path text;  -- chemin dans le bucket
alter table public.purchases add column if not exists invoice_name text;  -- nom d'origine du fichier
alter table public.purchases add column if not exists invoice_type text;  -- type (application/pdf, image/jpeg…)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brickfolio-factures', 'brickfolio-factures', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists brickfolio_factures_rw on storage.objects;
create policy brickfolio_factures_rw on storage.objects for all to authenticated
  using (bucket_id = 'brickfolio-factures' and (storage.foldername(name))[1] = auth.uid()::text and public.is_owner())
  with check (bucket_id = 'brickfolio-factures' and (storage.foldername(name))[1] = auth.uid()::text and public.is_owner());

-- ---------- Fiche Brickset (v0.6) ----------------------------------------------
-- Prix LEGO d'origine (Allemagne, en euros), dates de sortie et de retrait, thème, pièces.
-- Écrits par la fonction « bricklink » (secret BRICKSET_API_KEY), une fois par set puis tous les 30 jours tant qu'il n'est pas retiré.
alter table public.sets add column if not exists theme        text;
alter table public.sets add column if not exists subtheme     text;
alter table public.sets add column if not exists pieces       int;
alter table public.sets add column if not exists minifigs     int;
alter table public.sets add column if not exists rrp_eur      numeric(10,2);
alter table public.sets add column if not exists launch_date  date;
alter table public.sets add column if not exists exit_date    date;
alter table public.sets add column if not exists brickset_url text;
alter table public.sets add column if not exists brickset_at  timestamptz;

-- ---------- Opportunités (v0.10) : sets du catalogue dont le retrait approche ----------
-- Écrits par la fonction « bricklink » (action « scan ») : fiche Brickset + dernier relevé BrickLink (neuf).
-- Tables préfixées bf_ pour ne pas gêner l'autre application du projet.
create table if not exists public.bf_catalog (
  set_no        text primary key,              -- numéro BrickLink, ex. 75192-1
  name          text not null,
  year          int,
  image_url     text,
  theme         text,
  theme_group   text,
  subtheme      text,
  category      text,
  pieces        int,
  minifigs      int,
  rrp_eur       numeric(10,2),                 -- prix LEGO.com Allemagne
  launch_date   date,
  exit_date     date,
  availability  text,                          -- « LEGO exclusive », « Retail », « Retail - limited »…
  rating        numeric(3,1),                  -- note des avis Brickset (sur 5)
  review_count  int,
  owned_by      int,                           -- membres Brickset qui l'ont
  wanted_by     int,                           -- membres Brickset qui le veulent
  brickset_url  text,
  seen_at       timestamptz not null default now(),  -- dernier passage du balayage Brickset
  price_on      date,                          -- dernier relevé BrickLink (neuf, Europe)
  avg_sold      numeric(10,2),
  qty_sold      int,
  avg_stock     numeric(10,2),
  min_stock     numeric(10,2),
  qty_stock     int,
  price_error   text
);
create index if not exists bf_catalog_exit on public.bf_catalog (exit_date);

-- Sets surveillés (par compte).
create table if not exists public.bf_watch (
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  set_no      text not null,
  created_at  timestamptz not null default now(),
  primary key (owner, set_no)
);

alter table public.bf_catalog enable row level security;
alter table public.bf_watch   enable row level security;
drop policy if exists bf_catalog_read on public.bf_catalog;
create policy bf_catalog_read on public.bf_catalog for select to authenticated using (public.is_owner());
drop policy if exists bf_watch_rw on public.bf_watch;
create policy bf_watch_rw on public.bf_watch for all to authenticated
  using (owner = auth.uid() and public.is_owner()) with check (owner = auth.uid() and public.is_owner());
