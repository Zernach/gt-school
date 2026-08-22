export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'held' | 'superseded';
export type ProposalDecision = 'approve' | 'reject' | 'hold';

const NEXT: Record<ProposalDecision, ProposalStatus> = { approve: 'approved', reject: 'rejected', hold: 'held' };

export function transitionProposal(status: ProposalStatus, decision: ProposalDecision): ProposalStatus {
  if (status !== 'pending') throw new Error('proposal_transition_illegal');
  return NEXT[decision];
}
