create or replace function charge_status(p_charge_id uuid) returns text as $$
  select coalesce(
    (select kind from charge_events
      where charge_id = p_charge_id
        and kind in ('paid', 'failed', 'refunded', 'voided')
      order by occurred_at desc, id desc
      limit 1),
    'pending'
  );
$$ language sql stable;
