import type { ExtractedTicket } from '../types';
import { humanize, StatusBadge } from './StatusBadge';

export function TicketTable({ tickets }: { tickets: ExtractedTicket[] }) {
  return (
    <section aria-labelledby="tickets-heading" className="panel-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Joinable SQL fields</p>
          <h2 id="tickets-heading">Extracted tickets</h2>
        </div>
      </div>
      {tickets.length ? (
        <div className="table-scroll" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Student / family</th>
                <th scope="col">System record</th>
                <th scope="col">Issue</th>
                <th scope="col">Owner / action</th>
                <th scope="col">Dates</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <th scope="row">
                    <span className="mono">{ticket.student_ref ?? 'unlinked'}</span>
                    <small className="muted">{ticket.family_ref ?? 'no family'}</small>
                  </th>
                  <td>{ticket.system} · <span className="mono">{ticket.record_id ?? '—'}</span></td>
                  <td>
                    <StatusBadge status={ticket.status} />
                    <span>{humanize(ticket.issue_type)}</span>
                  </td>
                  <td>{ticket.owner} · {ticket.requested_action}</td>
                  <td>
                    {ticket.opened_at ? <time dateTime={ticket.opened_at}>{new Date(ticket.opened_at).toLocaleDateString()}</time> : '—'}
                    {ticket.resolved_at ? <> · resolved <time dateTime={ticket.resolved_at}>{new Date(ticket.resolved_at).toLocaleDateString()}</time></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">◷</span>
          <h3>No extracted tickets</h3>
          <p>Synthetic messages are parsed into student, family, system, record, issue, owner, action, and dates.</p>
        </div>
      )}
    </section>
  );
}
