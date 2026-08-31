create extension if not exists pgcrypto;

create type account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type normal_side as enum ('debit', 'credit');

create table ledger_accounts (
  code          text primary key,
  name          text not null,
  type          account_type not null,
  normal        normal_side not null,
  created_at    timestamptz not null default now()
);

create sequence journal_entries_seq as bigint;

create table journal_entries (
  id                uuid primary key default gen_random_uuid(),
  seq               bigint not null,
  effective_date    date not null,
  booked_at         timestamptz not null default now(),
  event_type        text not null,
  memo              text not null,
  source            text not null,
  source_ref        text,
  posting_key       text not null unique,
  reverses_entry_id uuid references journal_entries(id),
  corrects_entry_id uuid references journal_entries(id),
  policy_id         uuid,
  broker_id         uuid,
  claim_id          uuid,
  actor             text,
  prev_hash         text not null,
  hash              text not null
);

create unique index journal_entries_seq_key on journal_entries (seq);
create index journal_entries_effective on journal_entries (effective_date);
create index journal_entries_booked on journal_entries (booked_at);
create index journal_entries_policy on journal_entries (policy_id) where policy_id is not null;
create index journal_entries_broker on journal_entries (broker_id) where broker_id is not null;
create index journal_entries_claim on journal_entries (claim_id) where claim_id is not null;

create table journal_lines (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references journal_entries(id),
  line_no       int not null,
  account_code  text not null references ledger_accounts(code),
  side          normal_side not null,
  amount_minor  bigint not null check (amount_minor > 0),
  policy_id     uuid,
  broker_id     uuid,
  claim_id      uuid,
  unique (entry_id, line_no)
);

create index journal_lines_entry on journal_lines (entry_id);
create index journal_lines_account on journal_lines (account_code);

create or replace function ledger_immutable() returns trigger as $$
begin
  raise exception 'ledger rows are append-only: % on % is forbidden', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

create trigger journal_entries_no_update before update on journal_entries
  for each statement execute function ledger_immutable();
create trigger journal_entries_no_delete before delete on journal_entries
  for each statement execute function ledger_immutable();
create trigger journal_entries_no_truncate before truncate on journal_entries
  for each statement execute function ledger_immutable();

create trigger journal_lines_no_update before update on journal_lines
  for each statement execute function ledger_immutable();
create trigger journal_lines_no_delete before delete on journal_lines
  for each statement execute function ledger_immutable();
create trigger journal_lines_no_truncate before truncate on journal_lines
  for each statement execute function ledger_immutable();

create or replace function ledger_post(
  p_effective_date    date,
  p_event_type        text,
  p_memo              text,
  p_source            text,
  p_posting_key       text,
  p_lines             jsonb,
  p_source_ref        text default null,
  p_reverses_entry_id uuid default null,
  p_corrects_entry_id uuid default null,
  p_policy_id         uuid default null,
  p_broker_id         uuid default null,
  p_claim_id          uuid default null,
  p_actor             text default null,
  p_booked_at         timestamptz default null
) returns uuid as $$
declare
  v_entry_id   uuid;
  v_seq        bigint;
  v_prev_hash  text;
  v_hash       text;
  v_debits     bigint;
  v_credits    bigint;
  v_count      int;
  v_booked     timestamptz;
  v_payload    text;
  v_canon      text;
  v_existing   uuid;
begin
  select id into v_existing from journal_entries where posting_key = p_posting_key;
  if found then
    return v_existing;
  end if;

  perform pg_advisory_xact_lock(hashtext('ledger_chain'));

  v_count := jsonb_array_length(p_lines);
  if v_count is null or v_count < 2 then
    raise exception 'an entry needs at least two lines, got %', coalesce(v_count, 0);
  end if;

  select
    coalesce(sum(case when l->>'side' = 'debit'  then (l->>'amount_minor')::bigint else 0 end), 0),
    coalesce(sum(case when l->>'side' = 'credit' then (l->>'amount_minor')::bigint else 0 end), 0)
  into v_debits, v_credits
  from jsonb_array_elements(p_lines) l;

  if v_debits <> v_credits then
    raise exception 'entry does not balance: debits % credits %', v_debits, v_credits;
  end if;
  if v_debits = 0 then
    raise exception 'entry has no value';
  end if;

  v_booked := coalesce(p_booked_at, now());
  v_seq := nextval('journal_entries_seq');

  select coalesce(hash, repeat('0', 64)) into v_prev_hash
  from journal_entries order by seq desc limit 1;
  if v_prev_hash is null then
    v_prev_hash := repeat('0', 64);
  end if;

  select string_agg(
    (l->>'account_code') || ':' || (l->>'side') || ':' || (l->>'amount_minor')::bigint,
    ',' order by ord
  ) into v_canon
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  v_payload := v_prev_hash || '|' || v_seq::text || '|' || p_effective_date::text || '|' ||
    to_char(v_booked at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
    p_event_type || '|' || p_posting_key || '|' || v_canon;

  v_hash := encode(digest(v_payload, 'sha256'), 'hex');

  insert into journal_entries (
    seq, effective_date, booked_at, event_type, memo, source, source_ref, posting_key,
    reverses_entry_id, corrects_entry_id, policy_id, broker_id, claim_id, actor,
    prev_hash, hash
  ) values (
    v_seq, p_effective_date, v_booked, p_event_type, p_memo, p_source, p_source_ref, p_posting_key,
    p_reverses_entry_id, p_corrects_entry_id, p_policy_id, p_broker_id, p_claim_id, p_actor,
    v_prev_hash, v_hash
  ) returning id into v_entry_id;

  insert into journal_lines (entry_id, line_no, account_code, side, amount_minor, policy_id, broker_id, claim_id)
  select
    v_entry_id,
    (ord)::int,
    l->>'account_code',
    (l->>'side')::normal_side,
    (l->>'amount_minor')::bigint,
    coalesce(nullif(l->>'policy_id', '')::uuid, p_policy_id),
    coalesce(nullif(l->>'broker_id', '')::uuid, p_broker_id),
    coalesce(nullif(l->>'claim_id', '')::uuid, p_claim_id)
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  return v_entry_id;
end;
$$ language plpgsql;

create or replace function ledger_balance(
  p_account_code text,
  p_as_of        date default null,
  p_known_at     timestamptz default null
) returns bigint as $$
  select coalesce(sum(
    case when l.side = a.normal then l.amount_minor else -l.amount_minor end
  ), 0)::bigint
  from journal_lines l
  join journal_entries e on e.id = l.entry_id
  join ledger_accounts a on a.code = l.account_code
  where l.account_code = p_account_code
    and (p_as_of is null or e.effective_date <= p_as_of)
    and (p_known_at is null or e.booked_at <= p_known_at);
$$ language sql stable;

create or replace function ledger_verify_chain()
returns table (seq bigint, entry_id uuid, ok boolean, reason text) as $$
declare
  r          record;
  v_prev     text := repeat('0', 64);
  v_payload  text;
  v_hash     text;
begin
  for r in
    select e.id, e.seq, e.effective_date, e.booked_at, e.event_type, e.posting_key,
           e.prev_hash, e.hash,
           coalesce(string_agg(l.account_code || ':' || l.side || ':' || l.amount_minor, ',' order by l.line_no), '') as lines
    from journal_entries e
    left join journal_lines l on l.entry_id = e.id
    group by e.id, e.seq, e.effective_date, e.booked_at, e.event_type, e.posting_key, e.prev_hash, e.hash
    order by e.seq
  loop
    v_payload := v_prev || '|' || r.seq::text || '|' || r.effective_date::text || '|' ||
      to_char(r.booked_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' ||
      r.event_type || '|' || r.posting_key || '|' || r.lines;
    v_hash := encode(digest(v_payload, 'sha256'), 'hex');

    seq := r.seq;
    entry_id := r.id;
    if r.prev_hash <> v_prev then
      ok := false; reason := 'prev_hash does not match the preceding entry';
    elsif r.hash <> v_hash then
      ok := false; reason := 'content hash does not match stored hash';
    else
      ok := true; reason := null;
    end if;
    return next;
    v_prev := r.hash;
  end loop;
end;
$$ language plpgsql stable;
