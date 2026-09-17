-- Contact entry may acquire a lead. Subsequent updates, including booking, may only reuse it.
do $migration$
declare
  definition text;
  marker text := 'crm_lead_id := coalesce(crm_lead_id, ''wa-'' || new.id::text);';
  guard text := E'-- EC10_BOOKING_EXISTING_LEAD_ONLY\n  if TG_OP = ''UPDATE'' and crm_lead_id is null then\n    return new;\n  end if;\n  ';
begin
  select pg_get_functiondef('app_private.sync_whatsapp_client_to_crm()'::regprocedure) into definition;
  if position('EC10_BOOKING_EXISTING_LEAD_ONLY' in definition)>0 then return; end if;
  if position(marker in definition)=0 then raise exception 'CRM sync definition changed; migration refused'; end if;
  execute replace(definition,marker,guard||marker);
end;
$migration$;
