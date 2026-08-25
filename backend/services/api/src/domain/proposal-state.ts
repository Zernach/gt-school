export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'held' | 'superseded' | 'applied' | 'rolled_back';
export type ProposalDecision = 'approve' | 'reject' | 'hold';

const NEXT: Record<ProposalDecision, ProposalStatus> = { approve: 'approved', reject: 'rejected', hold: 'held' };

export function transitionProposal(status: ProposalStatus, decision: ProposalDecision): ProposalStatus {
  if (status !== 'pending') throw new Error('proposal_transition_illegal');
  return NEXT[decision];
}

export function transitionAutoApply(status: ProposalStatus): 'applied' {
  if (status !== 'pending') throw new Error('proposal_transition_illegal');
  return 'applied';
}

export function transitionRollback(status: ProposalStatus): 'rolled_back' {
  if (status !== 'applied') throw new Error('proposal_transition_illegal');
  return 'rolled_back';
}
