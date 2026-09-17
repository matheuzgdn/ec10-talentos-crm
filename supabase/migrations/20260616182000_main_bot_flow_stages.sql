alter table public.bot_conversation_states
drop constraint if exists bot_conversation_states_stage_check;

alter table public.bot_conversation_states
add constraint bot_conversation_states_stage_check
check (stage in (
  'awaiting_interest',
  'awaiting_role',
  'awaiting_age',
  'awaiting_foundation_status',
  'awaiting_meeting_date',
  'awaiting_meeting_time',
  'completed'
));

alter table public.bot_conversation_states
drop constraint if exists bot_conversation_states_age_group_check;

alter table public.bot_conversation_states
add constraint bot_conversation_states_age_group_check
check (age_group is null or age_group in ('8-12', '13-17', '18-plus', '8-13', '14-17'));
