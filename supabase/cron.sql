-- Brickfolio — relevé automatique des prix chaque lundi à 6 h (heure belge, ≈ 5 h UTC).
-- À lancer une fois dans Supabase > SQL Editor, APRÈS avoir déployé la fonction « bricklink »
-- et ajouté le secret CRON_SECRET (Edge Functions > Secrets).
--
-- Remplace les deux valeurs entre < > :
--   <PROJET>     : l'identifiant du projet (dans l'URL : https://<PROJET>.supabase.co)
--   <SECRET>     : la valeur choisie pour le secret CRON_SECRET
-- (La fonction doit avoir « Verify JWT » désactivé : elle contrôle elle-même qui l'appelle.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('brickfolio-prix-hebdo') where exists (select 1 from cron.job where jobname = 'brickfolio-prix-hebdo');

select cron.schedule(
  'brickfolio-prix-hebdo',
  '0 5 * * 1',
  $$
  select net.http_post(
    url     := 'https://<PROJET>.supabase.co/functions/v1/bricklink',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<SECRET>'
    ),
    body    := '{"action":"refresh"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Vérifier : select * from cron.job;   Historique : select * from cron.job_run_details order by start_time desc limit 5;
-- Résultat des relevés : select * from public.runs order by id desc limit 5;
