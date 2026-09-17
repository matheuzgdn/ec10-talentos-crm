alter table public.bot_conversation_states
drop constraint if exists bot_conversation_states_stage_check;

alter table public.bot_conversation_states
add constraint bot_conversation_states_stage_check
check (stage in ('awaiting_interest', 'awaiting_role', 'awaiting_age', 'awaiting_meeting_time', 'completed'));
