create table kyb_events (
  id            uuid primary key default gen_random_uuid(),
  broker_id     uuid not null references brokers(id),
  provider      text not null,
  provider_ref  text,
  status        kyb_status not null,
  reason        text,
  occurred_at   timestamptz not null default now(),
  payload       jsonb not null default '{}'::jsonb
);

create index kyb_events_broker on kyb_events (broker_id, occurred_at);

create trigger kyb_events_no_update before update on kyb_events
  for each statement execute function ledger_immutable();
create trigger kyb_events_no_delete before delete on kyb_events
  for each statement execute function ledger_immutable();
