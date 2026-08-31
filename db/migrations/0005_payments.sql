create table premium_charges (
  id               uuid primary key default gen_random_uuid(),
  policy_id        uuid not null references policies(id),
  version_id       uuid references policy_versions(id),
  reason           text not null,
  premium_minor    bigint not null,
  surcharge_minor  bigint not null,
  total_minor      bigint not null check (total_minor > 0),
  provider         text not null,
  checkout_ref     text,
  effective_date   date not null,
  created_at       timestamptz not null default now(),
  created_by       text not null
);

create index premium_charges_policy on premium_charges (policy_id);
create unique index premium_charges_checkout on premium_charges (checkout_ref) where checkout_ref is not null;

create table charge_events (
  id            uuid primary key default gen_random_uuid(),
  charge_id     uuid not null references premium_charges(id),
  kind          text not null,
  amount_minor  bigint not null default 0,
  provider_ref  text,
  occurred_at   timestamptz not null default now(),
  entry_id      uuid references journal_entries(id),
  detail        jsonb not null default '{}'::jsonb
);

create index charge_events_charge on charge_events (charge_id, occurred_at);

create table refunds (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references policies(id),
  charge_id      uuid references premium_charges(id),
  reason         text not null,
  premium_minor  bigint not null,
  surcharge_minor bigint not null,
  total_minor    bigint not null check (total_minor > 0),
  provider       text not null,
  provider_ref   text,
  effective_date date not null,
  created_at     timestamptz not null default now(),
  created_by     text not null
);

create index refunds_policy on refunds (policy_id);
create unique index refunds_provider_ref on refunds (provider_ref) where provider_ref is not null;

create trigger premium_charges_no_update before update on premium_charges
  for each statement execute function ledger_immutable();
create trigger premium_charges_no_delete before delete on premium_charges
  for each statement execute function ledger_immutable();
create trigger charge_events_no_update before update on charge_events
  for each statement execute function ledger_immutable();
create trigger charge_events_no_delete before delete on charge_events
  for each statement execute function ledger_immutable();
create trigger refunds_no_update before update on refunds
  for each statement execute function ledger_immutable();
create trigger refunds_no_delete before delete on refunds
  for each statement execute function ledger_immutable();

create or replace function charge_status(p_charge_id uuid) returns text as $$
  select coalesce(
    (select kind from charge_events
      where charge_id = p_charge_id
        and kind in ('paid', 'failed', 'refunded')
      order by occurred_at desc, id desc
      limit 1),
    'pending'
  );
$$ language sql stable;
