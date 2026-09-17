do $$
declare
  target_schema text;
begin
  foreach target_schema in array array['public', 'whatsapp_bot']
  loop
    if to_regclass(format('%I.bot_conversation_states', target_schema)) is null then
      continue;
    end if;

    execute format(
      'alter table %I.bot_conversation_states drop constraint if exists bot_conversation_states_stage_check',
      target_schema
    );
    execute format(
      'alter table %I.bot_conversation_states add constraint bot_conversation_states_stage_check check (stage in (%L,%L,%L,%L,%L,%L,%L,%L))',
      target_schema,
      'awaiting_interest',
      'awaiting_role',
      'awaiting_age',
      'awaiting_foundation_status',
      'awaiting_guardian_confirmation',
      'awaiting_meeting_date',
      'awaiting_meeting_time',
      'completed'
    );

    execute format(
      'alter table %I.bot_conversation_states drop constraint if exists bot_conversation_states_age_group_check',
      target_schema
    );
    execute format(
      'alter table %I.bot_conversation_states add constraint bot_conversation_states_age_group_check check (age_group is null or age_group in (%L,%L,%L,%L,%L,%L,%L,%L))',
      target_schema,
      '8-12',
      '13-17',
      '18-plus',
      '8-13',
      '14-17',
      '14-19',
      '20-25',
      '26-plus'
    );
  end loop;
end
$$;
