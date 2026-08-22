Feature: Cross-source reconciliation remains truthful and guarded

  Background:
    Given canonical synthetic fixtures generated with seed 424242
    And the Compose services are healthy

  Scenario: A complete sync establishes one coherent truth window
    When the scheduler submits a generation 3 sync with the sync secret
    Then 120000 source records are accepted
    And each record retains source identity, observed time, ingest time, and field lineage
    And the three active source pointers advance together
    And 3050 golden conflicts are detected with no extra or missing verdicts

  Scenario: A source failure cannot create a false clean result
    Given a last-known-complete active source set
    When CRM returns a synthetic 5xx through every bounded retry
    Then the sync completes with partial evidence and structured CRM failure detail
    And rules depending on CRM are unchecked rather than passed
    And no active source pointer advances

  Scenario: Reconciliation holds before every write
    Given 3050 active conflicts
    When the unattended reconciler completes
    Then each conflict has one created or deduplicated stable proposal
    And every newly created proposal is pending with evidence and deterministic confidence
    And sensitive actions are hard-held for human review
    And the source mirror hash is unchanged

  Scenario: A concurrent burst cannot overspend
    Given a 50 microcent daily and run cap
    When 20 unique 10 microcent actions reserve concurrently
    Then exactly 5 actions reach the provider-call boundary
    And exactly 15 actions stop with cap audits and critical alerts
    And a duplicate retry and a new-action retry cannot bypass the cap

  Scenario: A reviewer can audit before deciding
    When a keyboard user opens a pending conflict in the dashboard
    Then the modal shows invariant evidence, active field lineage, proposal policy, confidence, cost, and audit history
    And focus remains within the modal until Escape or Close
    And closing returns focus to the invoking conflict
    And approval records Keystone review state without mutating a source system
