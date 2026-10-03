> **FICTIONAL POLICY — CREATED FOR SYNTHETIC PORTFOLIO DEMONSTRATION ONLY**

# Prior Authorization Operations Policy

This fictional operating policy describes an invented organization's internal workflow. It is not a statement of CMS, Medicare, Medicaid, HIPAA, payer, legal, clinical, or regulatory requirements.

## Matching authorization records to claims

Before reviewing an authorization-related claim question, staff compare the authorization identifier and its member, provider, service category, requested service dates, and units with the corresponding claim fields. Record which fields matched, which differed, and which were unavailable. A linked identifier by itself does not prove that the records describe the same service or that one record caused the claim outcome.

Use the organization's approved matching workflow to resolve formatting differences. Do not infer a missing identifier or silently substitute another authorization. Route unresolved matches to the authorization reconciliation queue and preserve both source records.

## Handling authorization statuses

- **Approved:** Confirm that member, provider, service, date window, and units align with the claim. If a prior-authorization-related claim denial is associated with an approved authorization, open a reconciliation review. This association is an observed pattern only; it is not automatically an error, root cause, or causal finding.
- **Pending:** Check the request's current workflow state and decision history. Route unresolved pending items to the authorization work queue. Do not treat pending as approved or denied based only on a claim association.
- **Expired:** Compare the authorization validity dates with the service dates and verify whether the record was amended or replaced. Record the date comparison and refer unresolved discrepancies for review.
- **Denied:** Confirm the authorization decision record and its service scope. Keep the authorization decision distinct from the claim adjudication record; one does not by itself explain the other.
- **Missing or unlinked:** Search only the approved internal matching keys and systems. Record the search performed and its result. If no match is found, preserve the status as unlinked and route it for reconciliation rather than inferring that authorization was absent or unnecessary.
- **Not required:** Confirm the relevant service configuration and effective dates through the designated operations source. Record the reference used; do not infer this status from a missing authorization row.

## Reconciliation workflow

The reconciliation owner creates a case containing the claim reference, authorization reference when present, comparison fields, status and effective dates, source systems, and claim outcome. A second reviewer checks material mismatches before any correction or reprocessing request. Corrections preserve the original values, change history, reviewer, timestamp, and reason.

If the records remain inconsistent, the case is escalated to the authorization operations lead. The lead may request additional source documentation or a system trace. Any claim reprocessing consideration follows the separate denial review workflow and retains the original decision trail.

## Trend monitoring and documentation

Managers periodically compare linked, unlinked, pending, expired, denied, and approved authorization patterns by service category, program, provider, and time period. Reports state counts, denominators, matching rules, and limitations. Repeated patterns may warrant process review; aggregate associations alone do not establish an individual record error or cause.
