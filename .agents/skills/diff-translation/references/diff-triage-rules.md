# Diff triage rules

- **Low**: bounded source spelling, literal, link, or reviewed target metadata
  change with segment ownership and routes unchanged.
- **Mid**: bounded prose/code/table/image changes or same-source segment
  regrouping with a clear review surface.
- **High**: source/catalog addition or removal, pair/fallback drift, segment
  split/merge, cross-source composition, route/menu migration, license/brand,
  Astro/Starlight, projector/schema, SEO owner, redirect, or deployment control
  change.

Record a Chinese summary, affected source pairs, affected target routes, and
review recommendation for every material change. Do not invent line statistics
or automatically assign new segments. High-risk changes block promotion until
explicitly reconciled and verified through a recovery run.
