-- 4.4 review fix (spec-axis c.1): the one-active-search-per-session guard was
-- SELECT-then-throw — two concurrent submits could both pass. The database
-- now owns the invariant, same philosophy as every other guard.
--
-- Legacy data: any active non-demo searches are completed first so the index
-- can build on cloud (pre-flip, pre-real-users — nothing live to interrupt;
-- the runbook's flip sweep would have done the same minutes later).
update searches
  set status = 'complete', settled_at = now()
  where status = 'active' and dial_mode <> 'DEMO';

create unique index if not exists searches_one_active_per_owner
  on searches (owner)
  where (status = 'active' and dial_mode <> 'DEMO');
