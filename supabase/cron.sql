-- Brickfolio — relevé automatique des prix chaque lundi à 6 h (heure belge, ≈ 5 h UTC).
-- À lancer une fois dans Supabase > SQL Editor, APRÈS avoir déployé la fonction « bricklink ».
-- Remplace <PROJET> par l'identifiant du projet (dans l'URL : https://<PROJET>.supabase.co).
--
-- Le secret qui autorise la tâche planifiée est généré dans le coffre chiffré de Supabase (Vault) :
-- personne n'a à le connaître. La fonction le vérifie via public.brickfolio_cron_ok (réservée au serveur).
-- Le script peut être relancé sans danger.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'brickfolio_cron_secret', 'Brickfolio : autorise le relevé hebdomadaire')
where not exists (select 1 from vault.secrets where name = 'brickfolio_cron_secret');

create or replace function public.brickfolio_cron_ok(s text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'brickfolio_cron_secret' and decrypted_secret = s);
$$;
revoke all on function public.brickfolio_cron_ok(text) from public, anon, authenticated;
grant execute on function public.brickfolio_cron_ok(text) to service_role;

select cron.unschedule('brickfolio-prix-hebdo') where exists (select 1 from cron.job where jobname = 'brickfolio-prix-hebdo');

select cron.schedule(
  'brickfolio-prix-hebdo',
  '0 5 * * 1',
  $$
  select net.http_post(
    url     := 'https://<PROJET>.supabase.co/functions/v1/bricklink',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'brickfolio_cron_secret')
    ),
    body    := '{"action":"refresh"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Vérifier : select jobname, schedule from cron.job;
-- Historique : select * from cron.job_run_details order by start_time desc limit 5;
-- Résultat des relevés : select * from public.runs order by id desc limit 5;

-- Opportunités (v0.10) : chaque jour à 4 h 30 UTC. Le catalogue Brickset n'est parcouru qu'une fois par semaine
-- (la fonction le vérifie) ; les prix BrickLink des sets candidats sont relevés par lots, jour après jour.
select cron.unschedule('brickfolio-opportunites') where exists (select 1 from cron.job where jobname = 'brickfolio-opportunites');

select cron.schedule(
  'brickfolio-opportunites',
  '30 4 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJET>.supabase.co/functions/v1/bricklink',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'brickfolio_cron_secret')
    ),
    body    := '{"action":"scan"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
