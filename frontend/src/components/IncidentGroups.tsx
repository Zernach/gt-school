import { useMemo, useState } from 'react';
import type { IncidentGroup } from '../types';
import { DashboardSection } from './DashboardSection';
import { dashboardStory } from './dashboardStory';
import { humanize, StatusBadge } from './StatusBadge';

interface IncidentGroupsProps {
  groups: IncidentGroup[];
  groupedConflicts?: number | undefined;
  onPatternSelect?: (pattern: string) => void;
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

function percent(value: number, total: number): string {
  if (!total) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function IncidentGroups({ groups, groupedConflicts, onPatternSelect }: IncidentGroupsProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'members' | 'name'>('members');
  const groupedMemberCount = groups.reduce((total, group) => total + group.member_count, 0);
  const totalMembers = groupedConflicts ?? groupedMemberCount;
  const rankedGroups = useMemo(() => [...groups].sort((a, b) => b.member_count - a.member_count || a.id.localeCompare(b.id)), [groups]);
  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en-US');
    return [...rankedGroups]
      .filter((group) => !normalizedQuery || humanize(group.label).toLocaleLowerCase('en-US').includes(normalizedQuery) || group.label.toLocaleLowerCase('en-US').includes(normalizedQuery) || group.id.toLocaleLowerCase('en-US').includes(normalizedQuery))
      .sort((a, b) => sort === 'members' ? b.member_count - a.member_count || a.id.localeCompare(b.id) : humanize(a.label).localeCompare(humanize(b.label)));
  }, [query, rankedGroups, sort]);
  const topGroup = rankedGroups[0];
  const canReviewTopGroup = Boolean(topGroup && topGroup.label !== 'mixed');
  const topTwoCount = rankedGroups.slice(0, 2).reduce((total, group) => total + group.member_count, 0);
  const topTwoLabel = rankedGroups.length > 1
    ? `The two largest patterns account for ${percent(topTwoCount, totalMembers)} of grouped conflicts.`
    : topGroup
      ? `The largest pattern accounts for ${percent(topGroup.member_count, totalMembers)} of grouped conflicts.`
      : '';

  return (
    <DashboardSection
      id="incident-groups-section"
      headingId="groups-heading"
      descriptionId="groups-description"
      className="panel-section"
      heading={
        <div className="section-heading">
          <div>
            <p className="eyebrow">{dashboardStory.groups.step}</p>
            <h2 id="groups-heading">{dashboardStory.groups.title}</h2>
            <p id="groups-description" className="section-description">{dashboardStory.groups.description}</p>
          </div>
          <StatusBadge status="complete" label={`${groups.length} patterns`} />
        </div>
      }
    >
      {groups.length ? (
        <>
          <div className="cluster-summary" aria-label="Incident group summary">
            <div className="cluster-stat"><span>Grouped conflicts</span><strong>{number(totalMembers)}</strong><small>across {groups.length} detected patterns</small></div>
            <div className="cluster-stat"><span>Largest pattern</span><strong>{topGroup ? number(topGroup.member_count) : '0'}</strong><small>{topGroup ? humanize(topGroup.label) : 'No pattern data'}</small></div>
            <div className="cluster-stat"><span>Concentration</span><strong>{rankedGroups.length > 1 ? percent(topTwoCount, totalMembers) : percent(topGroup?.member_count ?? 0, totalMembers)}</strong><small>{rankedGroups.length > 1 ? 'in the top two patterns' : 'in the largest pattern'}</small></div>
          </div>

          {topGroup ? <aside className="cluster-insight" aria-labelledby="cluster-insight-heading">
            <div>
              <p className="eyebrow">Suggested starting point</p>
              <h3 id="cluster-insight-heading">{humanize(topGroup.label)}</h3>
              <p>{number(topGroup.member_count)} conflicts · {percent(topGroup.member_count, totalMembers)} of grouped conflicts</p>
            </div>
            <div className="cluster-insight-copy">
              <strong>Why start here?</strong>
              <p>{topTwoLabel} This is the highest-volume workstream in the current evidence window.</p>
              {onPatternSelect && canReviewTopGroup ? <button type="button" className="primary-button" onClick={() => onPatternSelect(topGroup.label)}>Review this pattern</button> : null}
            </div>
          </aside> : null}

          <div className="cluster-controls">
            <label>Find a pattern<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search labels or IDs" /></label>
            <label>Sort patterns<select value={sort} onChange={(event) => setSort(event.target.value as 'members' | 'name')}><option value="members">Largest first</option><option value="name">Pattern name</option></select></label>
            <p className="muted" aria-live="polite">Showing {visibleGroups.length} of {groups.length} patterns</p>
          </div>

          {visibleGroups.length ? <div className="table-scroll" tabIndex={0} aria-label="Scrollable incident group results">
            <table>
              <caption className="sr-only">Grouped conflict patterns with volume, share, and nearest related pattern</caption>
              <thead>
                <tr>
                  <th scope="col">Pattern</th>
                  <th scope="col">Members</th>
                  <th scope="col">Share of grouped conflicts</th>
                  <th scope="col">Nearest pattern</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => {
                  const nearestGroup = group.nearest_group_id ? groups.find((candidate) => candidate.id === group.nearest_group_id) : undefined;
                  return <tr key={group.id}>
                    <th scope="row"><div className="cluster-pattern"><strong>{humanize(group.label)}</strong><span className="mono">{group.id}</span></div></th>
                    <td><strong className="cluster-member-count">{number(group.member_count)}</strong></td>
                    <td><div className="cluster-share"><span>{percent(group.member_count, totalMembers)}</span><span className="cluster-share-track" aria-hidden="true"><span style={{ width: `${Math.min((group.member_count / (totalMembers || 1)) * 100, 100)}%` }} /></span></div></td>
                    <td>{group.nearest_group_id ? <div className="cluster-pattern"><strong>{nearestGroup ? humanize(nearestGroup.label) : 'Pattern not in this view'}</strong><span className="mono">{group.nearest_group_id}</span></div> : <span className="muted">No nearer pattern recorded</span>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div> : <div className="empty-state compact-empty"><span aria-hidden="true">⌕</span><h3>No matching patterns</h3><p>Try a different label or group ID.</p><button type="button" className="secondary-button" onClick={() => setQuery('')}>Clear search</button></div>}
        </>
      ) : (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">◷</span>
          <h3>No incident groups yet</h3>
          <p>Run the stretch job after reconciliation to cluster related failures.</p>
        </div>
      )}
    </DashboardSection>
  );
}
