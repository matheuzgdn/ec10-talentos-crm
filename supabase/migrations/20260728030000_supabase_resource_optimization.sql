create index if not exists traffic_events_occurred_at_idx
on public.traffic_events (occurred_at desc);
