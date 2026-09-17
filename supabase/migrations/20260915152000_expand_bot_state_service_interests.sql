begin;

alter table whatsapp_bot.bot_conversation_states
  drop constraint if exists bot_conversation_states_service_interest_check;

alter table whatsapp_bot.bot_conversation_states
  add constraint bot_conversation_states_service_interest_check
  check (
    service_interest is null
    or service_interest in (
      'plano_internacional',
      'plano_carreira',
      'ambos',
      'nao_definido',
      'eurocamp',
      'eurocamp_latam',
      'mentoria_prime',
      'libertacademy_florianopolis',
      'academy_sudamerica'
    )
  );

commit;
