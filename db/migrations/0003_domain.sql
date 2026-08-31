create type user_role as enum ('staff', 'broker', 'customer');
create type kyb_status as enum ('unverified', 'pending', 'approved', 'failed');
create type policy_status as enum ('quoted', 'bound', 'cancelled', 'expired');
create type version_kind as enum ('issuance', 'endorsement', 'cancellation', 'reversal', 'rebook');
create type claim_status as enum ('open', 'closed', 'denied');
create type claim_event_kind as enum ('reserve_set', 'reserve_adjusted', 'payment', 'closed', 'denied');
create type approval_status as enum ('pending', 'approved', 'rejected');

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text not null,
  role          user_role not null,
  password_hash text not null,
  broker_id     uuid,
  customer_id   uuid,
  created_at    timestamptz not null default now()
);

create table brokers (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  legal_name           text not null,
  ein                  text,
  commission_rate_bps  int not null,
  kyb_status           kyb_status not null default 'unverified',
  kyb_provider         text,
  kyb_reference        text,
  kyb_checked_at       timestamptz,
  kyb_failure_reason   text,
  created_at           timestamptz not null default now()
);

create table customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  legal_name  text not null,
  email       text not null,
  state_code  text not null,
  created_at  timestamptz not null default now()
);

create table tax_rates (
  id             uuid primary key default gen_random_uuid(),
  state_code     text not null,
  kind           text not null,
  rate_bps       int,
  flat_minor     bigint,
  refundable     boolean not null,
  effective_from date not null,
  effective_to   date,
  authority      text not null
);

create table policies (
  id             uuid primary key default gen_random_uuid(),
  policy_number  text not null unique,
  broker_id      uuid not null references brokers(id),
  customer_id    uuid not null references customers(id),
  product_code   text not null,
  state_code     text not null,
  term_start     date not null,
  term_end       date not null,
  status         policy_status not null default 'quoted',
  created_at     timestamptz not null default now()
);

create table policy_versions (
  id                  uuid primary key default gen_random_uuid(),
  policy_id           uuid not null references policies(id),
  version_no          int not null,
  kind                version_kind not null,
  effective_date      date not null,
  booked_at           timestamptz not null default now(),
  reverses_version_id uuid references policy_versions(id),
  corrects_version_id uuid references policy_versions(id),
  limit_minor         bigint not null,
  deductible_minor    bigint not null,
  annual_premium_minor bigint not null,
  exposures           jsonb not null default '[]'::jsonb,
  description         text not null,
  actor               text,
  unique (policy_id, version_no)
);

create index policy_versions_policy on policy_versions (policy_id, effective_date, booked_at);

create table premium_layers (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references policies(id),
  version_id     uuid not null references policy_versions(id),
  starts_on      date not null,
  ends_on        date not null,
  amount_minor   bigint not null,
  booked_at      timestamptz not null default now(),
  reverses_layer_id uuid references premium_layers(id)
);

create index premium_layers_policy on premium_layers (policy_id);

create table claims (
  id            uuid primary key default gen_random_uuid(),
  claim_number  text not null unique,
  policy_id     uuid not null references policies(id),
  loss_date     date not null,
  reported_date date not null,
  status        claim_status not null default 'open',
  description   text not null,
  payee_name    text,
  payee_account_verified boolean not null default false,
  payee_provider text,
  payee_reference text,
  created_at    timestamptz not null default now()
);

create table claim_events (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references claims(id),
  kind           claim_event_kind not null,
  amount_minor   bigint not null default 0,
  effective_date date not null,
  booked_at      timestamptz not null default now(),
  memo           text not null,
  actor          text,
  entry_id       uuid references journal_entries(id),
  reverses_event_id uuid references claim_events(id)
);

create index claim_events_claim on claim_events (claim_id, effective_date, booked_at);

create table approvals (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null,
  payload        jsonb not null,
  amount_minor   bigint not null,
  threshold_minor bigint not null,
  status         approval_status not null default 'pending',
  requested_by   uuid not null references users(id),
  requested_via  text not null,
  decided_by     uuid references users(id),
  decided_at     timestamptz,
  decision_note  text,
  result_ref     text,
  created_at     timestamptz not null default now(),
  constraint approver_is_not_initiator check (decided_by is null or decided_by <> requested_by)
);

create table webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  signature_valid   boolean not null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  status            text not null default 'received',
  attempts          int not null default 0,
  error             text,
  unique (provider, provider_event_id)
);

create index webhook_events_status on webhook_events (status, received_at);

create table recon_runs (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  period_start date not null,
  period_end   date not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',
  checked      int not null default 0,
  break_count  int not null default 0
);

create table recon_breaks (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references recon_runs(id),
  kind                 text not null,
  provider_reference   text,
  entry_id             uuid references journal_entries(id),
  provider_amount_minor bigint,
  ledger_amount_minor  bigint,
  occurred_on          date,
  first_seen_at        timestamptz not null default now(),
  resolved_at          timestamptz,
  resolution_entry_id  uuid references journal_entries(id),
  detail               text not null
);

create index recon_breaks_open on recon_breaks (resolved_at) where resolved_at is null;

create table documents (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references policies(id),
  version_id     uuid references policy_versions(id),
  kind           text not null,
  as_of_date     date not null,
  generated_at   timestamptz not null default now(),
  content        bytea not null,
  content_hash   text not null
);

create index documents_policy on documents (policy_id, kind, as_of_date);

create table decision_events (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  subject     text not null,
  detail      jsonb not null default '{}'::jsonb
);

create trigger policy_versions_no_update before update on policy_versions
  for each statement execute function ledger_immutable();
create trigger policy_versions_no_delete before delete on policy_versions
  for each statement execute function ledger_immutable();
create trigger premium_layers_no_update before update on premium_layers
  for each statement execute function ledger_immutable();
create trigger premium_layers_no_delete before delete on premium_layers
  for each statement execute function ledger_immutable();
create trigger claim_events_no_update before update on claim_events
  for each statement execute function ledger_immutable();
create trigger claim_events_no_delete before delete on claim_events
  for each statement execute function ledger_immutable();

insert into tax_rates (state_code, kind, rate_bps, flat_minor, refundable, effective_from, authority) values
  ('CA', 'surplus_lines_tax', 300, null, true,  '2020-01-01', 'CA Ins Code 1775.5 - 3.00% of gross premium'),
  ('CA', 'stamping_fee',       18, null, true,  '2023-01-01', 'SLA of California stamping fee - 0.18%'),
  ('CA', 'policy_fee',       null, 2500, false, '2020-01-01', 'Carrier flat policy fee, fully earned at inception');
