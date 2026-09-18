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
      $sql$
        update %I.bot_conversation_states
        set stage = 'awaiting_booking_completion',
            metadata = coalesce(metadata, '{}'::jsonb)
              || jsonb_build_object('bookingStateRepairedAt', now(), 'bookingStateRepairVersion', '20260918-v1'),
            updated_at = now()
        where stage = 'awaiting_interest'
          and nullif(metadata->>'bookingUrl', '') is not null
          and nullif(metadata->>'bookingId', '') is null
          and nullif(metadata->'meeting'->>'bookingId', '') is null
      $sql$,
      target_schema
    );
  end loop;
end
$$;
