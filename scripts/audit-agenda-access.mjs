import { bookingPool } from "../api/_booking-db.ts";

const database = await bookingPool.connect();

try {
  await database.query("begin read only");

  const roleCounts = (await database.query(`
    select role, count(*)::int as total
    from public.profiles
    group by role
    order by role
  `)).rows;

  const taskCounts = (await database.query(`
    select
      count(*)::int as total,
      count(*) filter (where data->>'source' = 'booking_ec10')::int as booking_tasks,
      count(*) filter (where data->>'status' <> 'cancelada')::int as visible_tasks
    from public.tarefas t
    join public.organizations o on o.id = t.organization_id
    where o.slug = 'ec10-talentos'
  `)).rows[0];

  const bookingCounts = (await database.query(`
    select
      count(*)::int as total,
      count(*) filter (where status = 'confirmed')::int as confirmed,
      count(*) filter (
        where status = 'confirmed'
          and exists (
            select 1 from public.tarefas t
            where t.id = 'booking-' || ec10_bookings.id::text
          )
      )::int as mirrored
    from whatsapp_bot.ec10_bookings
  `)).rows[0];

  const policies = (await database.query(`
    select schemaname, tablename, policyname, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename in ('tarefas', 'leads')
    order by tablename, policyname
  `)).rows;

  const agendaFunction = (await database.query(`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_booking_availability'
    limit 1
  `)).rows[0]?.definition ?? null;

  const authorizationFunctions = (await database.query(`
    select p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in (
        'has_organization_permission',
        'has_organization_role',
        'is_organization_member',
        'is_platform_admin',
        'is_superadmin'
      )
    order by p.proname
  `)).rows;

  const authorizationColumns = (await database.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and (table_name like '%permission%' or table_name like '%role%' or table_name = 'organization_members')
    order by table_name, ordinal_position
  `)).rows;

  const effectiveAccess = (await database.query(`
    select
      p.role as profile_role,
      count(distinct p.auth_user_id)::int as users,
      count(distinct p.auth_user_id) filter (where om.is_owner)::int as owners,
      count(distinct p.auth_user_id) filter (where rp.permission_key = 'task.view')::int as task_view,
      count(distinct p.auth_user_id) filter (where rp.permission_key = 'task.manage')::int as task_manage
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    join public.profiles p on p.auth_user_id = om.user_id
    left join public.organization_member_roles omr on omr.organization_member_id = om.id
    left join public.role_permissions rp on rp.role_id = omr.role_id
    where o.slug = 'ec10-talentos' and om.status = 'active'
    group by p.role
    order by p.role
  `)).rows;

  const bookingAuthColumns = (await database.query(`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema = 'whatsapp_bot'
      and table_name in ('crm_auth_users', 'sellers')
    order by table_name, ordinal_position
  `)).rows;

  const bookingRoleCounts = (await database.query(`
    select role, count(*)::int as total
    from whatsapp_bot.sellers
    where active = true
    group by role
    order by role
  `)).rows;

  console.log(JSON.stringify({
    roleCounts,
    taskCounts,
    bookingCounts,
    policies,
    agendaFunction,
    authorizationFunctions,
    authorizationColumns,
    effectiveAccess,
    bookingAuthColumns,
    bookingRoleCounts,
  }, null, 2));

  await database.query("rollback");
} finally {
  database.release();
}
