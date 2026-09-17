insert into public.bot_rules (name, trigger, response_text, priority, active, once_per_client, cooldown_minutes)
select
  'Boas-vindas inicial',
  '*',
  'Oi! Recebi sua mensagem. Vou te direcionar para o atendimento certo. Trabalhamos com plano internacional e plano de carreira; um vendedor vai assumir seu atendimento por aqui.',
  100,
  true,
  true,
  1440
where not exists (
  select 1
  from public.bot_rules
  where name = 'Boas-vindas inicial'
);

update public.bot_rules
set response_text = 'Oi! Recebi sua mensagem. Vou te direcionar para o atendimento certo. Trabalhamos com plano internacional e plano de carreira; um vendedor vai assumir seu atendimento por aqui.',
    once_per_client = true,
    cooldown_minutes = 1440
where name = 'Boas-vindas inicial';
