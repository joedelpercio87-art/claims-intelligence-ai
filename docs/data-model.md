# Synthetic data model

`members` and `providers` are fictional reference entities. `authorizations` records synthetic service requests and statuses. `claims` stores adjudication outcome and service/receipt/processing dates. Each claim has two `claim_lines`, each with a synthetic procedure category, service category, diagnosis category, and fictional amounts.

There are 40,000 claim lines across service dates in July, August, and September 2026. Generator seed: `20260926`. A seeded pseudorandom generator makes entity assignments, operational variation, and amounts repeatable.

The generator introduces ordinary variation across months and programs. August contains a higher outpatient imaging denial share and elevated prior-authorization category associations at a subset of imaging providers. These are synthetic observations only: the fields do not encode a cause or a conclusion about intent, care, medical necessity, fraud, abuse, or fault.
