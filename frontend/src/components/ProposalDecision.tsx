import { useId, useState, type FormEvent } from 'react';
import { decideProposal, rollbackProposal } from '../api';
import type { Proposal } from '../types';

export function ProposalDecision({ proposal, onDecided }: { proposal: Proposal; onDecided: (proposal: Proposal) => void }) {
  const reasonId = useId();
  const [decision, setDecision] = useState<'approve' | 'reject' | 'hold'>('hold');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || reason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      onDecided(await decideProposal(proposal.id, decision, reason.trim(), proposal.version));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Decision failed. Reload and retry.');
    } finally {
      setBusy(false);
    }
  };
  const rollback = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError('');
    try {
      const result = await rollbackProposal(proposal.id);
      onDecided({ ...proposal, ...result, status: result.status ?? 'rolled_back' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Rollback failed. Reload and retry.');
    } finally {
      setBusy(false);
    }
  };
  if (proposal.status === 'applied') {
    return (
      <form className="decision-form" onSubmit={(event) => { void rollback(event); }}>
        <fieldset disabled={busy}>
          <legend>Roll back auto-apply</legend>
          <p>This undoes Keystone auto-apply only. The proposal becomes rolled back and will not auto-apply again. Source systems remain unchanged.</p>
          <label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />I confirm this rollback and understand it does not mutate a source system.</label>
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={!confirmed || busy}>{busy ? 'Rolling back…' : 'Confirm rollback'}</button>
        </fieldset>
      </form>
    );
  }
  if (proposal.status !== 'pending') return <p className="decision-complete" role="status">Decision recorded: {proposal.status}. This changed Keystone review state only.</p>;
  return (
    <form className="decision-form" onSubmit={(event) => { void submit(event); }}>
      <fieldset disabled={busy}>
        <legend>Review this proposal</legend>
        <p>Approval records reviewer intent in Keystone. Core mode still has no source-system writer.</p>
        <div className="decision-options">
          {(['approve', 'reject', 'hold'] as const).map((value) => <label key={value}><input type="radio" name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} />{value}</label>)}
        </div>
        <label htmlFor={reasonId}>Reason<textarea id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required /></label>
        <label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />I confirm this decision and understand it does not mutate a source system.</label>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={!confirmed || reason.trim().length < 3 || busy}>{busy ? 'Recording…' : `Confirm ${decision}`}</button>
      </fieldset>
    </form>
  );
}
