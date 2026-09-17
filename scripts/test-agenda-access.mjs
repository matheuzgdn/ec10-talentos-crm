import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.EC10_BOOKING_DB_URL;
if (!connectionString) throw new Error("Banco de testes nao configurado.");

const migration = await readFile(
  new URL("../supabase/migrations/20260917211251_admin_superadmin_full_agenda_access.sql", import.meta.url),
  "utf8",
);
const migrationBody = migration
  .replace(/^\s*begin\s*;?/i, "")
  .replace(/commit\s*;?\s*$/i, "");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

async function assumeAuthenticated(userId) {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

async function resetDatabaseRole() {
  await client.query("reset role");
}

try {
  await client.query("begin");
  await client.query(migrationBody);

  const organization = (await client.query(`
    select id
    from public.organizations
    where slug='ec10-talentos' and status='active'
  `)).rows[0];
  assert.ok(organization?.id, "A organizacao EC10 precisa existir.");

  const expectedSellerCount = Number((await client.query(`
    select count(*)
    from whatsapp_bot.ec10_default_agenda a
    join whatsapp_bot.sellers s on s.id=a.seller_id
    where a.organization_id=$1 and s.active
  `, [organization.id])).rows[0].count);

  const expectedTaskCount = Number((await client.query(`
    select count(*)
    from public.tarefas
    where organization_id=$1
  `, [organization.id])).rows[0].count);

  assert.ok(expectedSellerCount > 1, "O teste precisa de mais de um vendedor ativo.");
  assert.ok(expectedTaskCount > 0, "O teste precisa de compromissos reais na agenda.");

  for (const profileRole of ["admin", "superadmin"]) {
    const account = (await client.query(`
      select p.auth_user_id
      from public.profiles p
      join public.organization_members om on om.user_id=p.auth_user_id
      where om.organization_id=$1
        and om.status='active'
        and p.is_active=true
        and p.role=$2
      limit 1
    `, [organization.id, profileRole])).rows[0];
    assert.ok(account?.auth_user_id, `O teste precisa de um ${profileRole} ativo.`);

    await assumeAuthenticated(account.auth_user_id);
    const agenda = (await client.query("select public.crm_booking_availability('list') as result")).rows[0].result;
    const visibleTaskCount = Number((await client.query(`
      select count(*)
      from public.tarefas
      where organization_id=$1
    `, [organization.id])).rows[0].count);
    await resetDatabaseRole();

    assert.equal(agenda.canViewTeam, true, `${profileRole} deve enxergar a equipe.`);
    assert.equal(agenda.sellers.length, expectedSellerCount, `${profileRole} deve enxergar todos os vendedores.`);
    assert.equal(visibleTaskCount, expectedTaskCount, `${profileRole} deve enxergar todos os compromissos.`);
  }

  await client.query("savepoint non_member_check");
  try {
    await assumeAuthenticated(randomUUID());
    await client.query("select public.crm_booking_availability('list')");
    assert.fail("Usuario fora da organizacao nao pode abrir a agenda.");
  } catch (error) {
    assert.equal(error.code, "42501", "A agenda deve negar usuario fora da organizacao.");
    await client.query("rollback to savepoint non_member_check");
    await resetDatabaseRole();
  }

  await client.query("rollback");
  console.log(JSON.stringify({
    ok: true,
    rolesTested: ["admin", "superadmin"],
    sellersVisible: expectedSellerCount,
    appointmentsVisible: expectedTaskCount,
    crossOrganizationAccessDenied: true,
  }));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
