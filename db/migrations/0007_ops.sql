create table ops_flags (
  name       text primary key,
  enabled    boolean not null default false,
  note       text,
  changed_at timestamptz not null default now(),
  changed_by text
);

insert into ops_flags (name, enabled, note) values
  ('stripe_outage', false, 'When on, every outbound Stripe call fails fast so degradation can be shown deliberately.');
