export const dashboardStory = {
  overview: {
    step: '01 · Orient',
    title: 'Start with the evidence',
    description: 'Read the current trust posture: what is verified, what is incomplete, and where to begin. Counts come from read-only evidence.'
  },
  conflicts: {
    step: '02 · Investigate',
    title: 'Find the conflicts',
    description: 'See where versioned checks found a disagreement across systems. Open a conflict to compare exact values, lineage, and any guarded proposal.'
  },
  groups: {
    step: '03 · Prioritize',
    title: 'See the bigger pattern',
    description: 'Group related conflicts into workstreams so you can prioritize the highest-volume pattern before reviewing individual evidence.'
  },
  proposals: {
    step: '04 · Decide',
    title: 'Decide what to record',
    description: 'Review the evidence behind each proposed action, then approve, reject, or hold what Keystone should record. Source systems remain unchanged.'
  },
  tickets: {
    step: '05 · Add context',
    title: 'Add support context',
    description: 'Connect each request to its student, household, source record, and conflict so support context can inform review.'
  }
} as const;
