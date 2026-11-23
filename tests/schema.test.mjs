// Test du schéma Supabase dans un Postgres en mémoire : npm i @electric-sql/pglite puis node tests/schema.test.mjs
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";

const db = new PGlite();
const q = (s) => db.exec(s);
// Ce que Supabase fournit : rôles, auth.users, auth.uid(), auth.jwt().
await q(`
create role authenticated; create role anon;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'cedric@test.be'),
  ('00000000-0000-0000-0000-00000000000b', 'partenaire@test.be'),
  ('00000000-0000-0000-0000-00000000000c', 'intrus@test.be');
`);
const schema = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
await q(schema); await q(schema); // relançable
await q(`insert into public.owners values ('cedric@test.be'), ('partenaire@test.be');
  insert into public.sets values ('10294-1', 'Titanic', 2021, null, null, now());
  insert into public.prices (set_no, condition, avg_sold) values ('10294-1', 'N', 610);
  grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;`);

const EMAIL = { a: "cedric@test.be", b: "partenaire@test.be", c: "intrus@test.be" };
const as = async (u, sql) => {
  await q(`reset role; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000${u}';
    set request.jwt.claims = '{"email":"${EMAIL[u].toUpperCase()}"}'; set role authenticated;`);
  return (await db.query(sql)).rows;
};
let n = 0;
const ok = (label) => { n++; console.log("ok -", label); };

const ins = `insert into purchases (set_no, condition, qty, unit_price, bought_on) values ('10294-1','N',1,539.99,'2023-03-14') returning id`;
const [{ id }] = await as("a", ins); ok("un compte autorisé enregistre un achat");
assert.equal((await as("a", `select is_owner() as o`))[0].o, true); ok("is_owner insensible à la casse de l'e-mail");
assert.equal((await as("a", `select count(*)::int c from purchases`))[0].c, 1);
assert.equal((await as("b", `select count(*)::int c from purchases`))[0].c, 0); ok("le partenaire ne voit pas les achats de l'autre");
assert.equal((await as("b", `update purchases set unit_price = 1 where id = '${id}' returning id`)).length, 0); ok("ni ne les modifie");
await assert.rejects(as("c", ins), /row-level security/); ok("un compte non autorisé ne peut rien enregistrer");
assert.equal((await as("c", `select count(*)::int c from prices`))[0].c, 0); ok("ni lire les prix");
assert.equal((await as("a", `select count(*)::int c from prices`))[0].c, 1); ok("les comptes autorisés lisent les prix");
await assert.rejects(as("a", `insert into prices (set_no, condition, avg_sold) values ('10294-1','U',1)`), /row-level security/); ok("prix en lecture seule depuis l'app");
await assert.rejects(as("a", `insert into owners values ('pirate@test.be')`), /row-level security/); ok("on ne s'ajoute pas soi-même aux comptes autorisés");
await assert.rejects(as("a", `insert into purchases (set_no, condition, qty, unit_price, bought_on) values ('1-1','X',1,1,'2024-01-01')`), /check/); ok("état limité à N / U");
const [{ updated_at: u1 }] = await as("a", `select updated_at from purchases where id = '${id}'`);
await new Promise((r) => setTimeout(r, 20));
await q(`reset role; begin; commit;`);
const [{ updated_at: u2 }] = await as("a", `update purchases set sold_price = 700, sold_on = '2024-01-01' where id = '${id}' returning updated_at`);
assert.ok(new Date(u2) >= new Date(u1)); ok("vente enregistrée, date de mise à jour touchée");
await q(`reset role; insert into public.prices (set_no, condition, avg_sold) values ('10294-1','N',620) on conflict (set_no, condition, fetched_on) do update set avg_sold = excluded.avg_sold`);
assert.equal((await as("a", `select avg_sold::float v from prices where condition='N'`))[0].v, 620); ok("un relevé par set, état et jour (upsert)");

// Valeurs manuelles : chacun les siennes.
await as("a", `insert into manual_values (set_no, condition, valued_on, unit_value) values ('10294-1','N','2026-11-20',640)`);
ok("valeur manuelle encodée");
assert.equal((await as("a", `select count(*)::int c from manual_values`))[0].c, 1);
assert.equal((await as("b", `select count(*)::int c from manual_values`))[0].c, 0); ok("invisible pour l'autre compte");
assert.equal((await as("b", `delete from manual_values returning id`)).length, 0); ok("ni supprimable par lui");
await assert.rejects(as("c", `insert into manual_values (set_no, unit_value) values ('1-1', 1)`), /row-level security/); ok("refusée à un compte non autorisé");
assert.equal((await as("a", `delete from manual_values returning id`)).length, 1); ok("supprimable par son auteur");

console.log(`\n${n} vérifications réussies`);
