import type { IncidentGroup } from '../types';
import { humanize, StatusBadge } from './StatusBadge';

export function IncidentGroups({ groups }: { groups: IncidentGroup[] }) {
  return (
    <section aria-labelledby="groups-heading" className="panel-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">pgvector cosine clusters</p>
          <h2 id="groups-heading">Incident groups</h2>
        </div>
        <StatusBadge status="complete" label={`${groups.length} patterns`} />
      </div>
      {groups.length ? (
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Pattern</th>
                <th scope="col">Members</th>
                <th scope="col">Nearest neighbor</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <th scope="row">{humanize(group.label)}</th>
                  <td><span className="mono">{group.member_count}</span></td>
                  <td>{group.nearest_group_id ? <span className="mono">{group.nearest_group_id}</span> : 'None closer than this cluster'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">◷</span>
          <h3>No incident groups yet</h3>
          <p>Run the stretch job after reconciliation to cluster related failures.</p>
        </div>
      )}
    </section>
  );
}
