begin;
alter table whatsapp_bot.ec10_bookings add column if not exists athlete_video_url text;
notify pgrst,'reload schema';
commit;
