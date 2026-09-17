alter table public.outbound_messages
  add column if not exists whatsapp_send_attempts integer not null default 0;

create index if not exists outbound_delivery_retry_idx
on public.outbound_messages (bot_instance_id, status, coalesce(scheduled_at, created_at), whatsapp_send_attempts)
where status = 'queued';
