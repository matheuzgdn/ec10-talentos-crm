alter table public.messages
  add column if not exists whatsapp_ack integer,
  add column if not exists whatsapp_ack_at timestamptz,
  add column if not exists whatsapp_chat_id text;

alter table public.outbound_messages
  add column if not exists whatsapp_message_id text,
  add column if not exists whatsapp_ack integer,
  add column if not exists whatsapp_ack_at timestamptz,
  add column if not exists whatsapp_chat_id text;

create index if not exists messages_outbound_whatsapp_ack_idx
on public.messages (bot_instance_id, whatsapp_message_id, whatsapp_ack)
where direction = 'outbound' and nullif(whatsapp_message_id, '') is not null;

create index if not exists outbound_whatsapp_delivery_idx
on public.outbound_messages (bot_instance_id, whatsapp_message_id, whatsapp_ack)
where nullif(whatsapp_message_id, '') is not null;
