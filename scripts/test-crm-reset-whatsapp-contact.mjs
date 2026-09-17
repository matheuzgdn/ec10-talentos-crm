import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingPool } from '../api/_booking-db.ts';

const db = await bookingPool.connect();
const leadId = randomUUID();
const phone = `+5500${String(Date.now()).slice(-9)}`;

try {
  await db.query('begin');
  const context = await db.query(`
    select user_account.id as user_id, organization.id as organization_id
    from auth.users user_account
    cross join public.organizations organization
    where app_private.is_superadmin(user_account.id)
      and organization.slug = 'ec10-talentos'
      and organization.status = 'active'
    limit 1
  `);
  assert.equal(context.rowCount, 1, 'A superadministrator and EC10 organization are required');
  const { user_id: userId, organization_id: organizationId } = context.rows[0];

  const insertedClient = await db.query(`
    insert into whatsapp_bot.clients (phone, name)
    values ($1, 'EC10 QA Reset')
    returning id
  `, [phone]);
  const clientId = insertedClient.rows[0].id;

  await db.query(`
    insert into whatsapp_bot.messages (client_id, direction, body)
    values ($1, 'inbound', 'Mensagem sintetica de teste; transacao sera revertida.')
  `, [clientId]);
  await db.query(`
    insert into public.leads (id, organization_id, created_by, updated_by, data)
    values ($1, $2, $3, $3, jsonb_build_object(
      'nome_atleta', 'EC10 QA Reset',
      'telefone', $4::text,
      'telefone_e164', $4::text,
      'whatsapp_client_id', ($5::uuid)::text,
      'status', 'novo_lead'
    ))
  `, [leadId, organizationId, userId, phone, clientId]);

  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await db.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
  await db.query('set local role authenticated');
  const reset = await db.query(`select public.crm_reset_whatsapp_contact($1) as result`, [leadId]);
  await db.query('reset role');

  assert.equal(reset.rows[0].result.reset, true);
  assert.ok(reset.rows[0].result.removedClients >= 1);
  assert.ok(reset.rows[0].result.removedCards >= 1);
  const remaining = await db.query(`
    select
      (select count(*)::int from public.leads
        where id = $1
           or app_private.whatsapp_phone_match_key(coalesce(data->>'telefone_e164', data->>'telefone')) = app_private.whatsapp_phone_match_key($3)) as cards,
      (select count(*)::int from whatsapp_bot.clients
        where id = $2
           or app_private.whatsapp_phone_match_key(phone) = app_private.whatsapp_phone_match_key($3)) as clients,
      (select count(*)::int from whatsapp_bot.messages where client_id = $2) as messages
  `, [leadId, clientId, phone]);
  assert.deepEqual(remaining.rows[0], { cards: 0, clients: 0, messages: 0 });

  await db.query('rollback');
  console.log(JSON.stringify({
    checksPassed: 6,
    removedClients: reset.rows[0].result.removedClients,
    removedCards: reset.rows[0].result.removedCards,
    cardRemoved: true,
    botClientRemoved: true,
    messagesRemoved: true,
    nextInboundCanStartFresh: true,
    persistentChanges: 0
  }));
} catch (error) {
  await db.query('rollback').catch(() => undefined);
  throw error;
} finally {
  db.release();
}
