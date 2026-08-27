import type { ExtractedTicket } from '../types';
import { Accordion } from './Accordion';
import { dashboardStory } from './dashboardStory';
import { humanize, StatusBadge } from './StatusBadge';

interface TicketTableProps {
  tickets: ExtractedTicket[];
  onConflict?: (id: string) => void;
  defaultOpen?: boolean;
}

function ticketDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Date unavailable';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function actionLabel(value: string): string {
  return humanize(value.replaceAll(':', ' '));
}

function systemLabel(value: string): string {
  return ({ crm: 'CRM', app: 'App database', payments: 'Payments', unknown: 'Unknown source' } as Record<string, string>)[value] ?? humanize(value);
}

function TicketDate({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{ticketDate(value)}</time> : <span className="muted">Not recorded</span>;
}

export function TicketTable({ tickets, onConflict, defaultOpen = true }: TicketTableProps) {
  const openCount = tickets.filter((ticket) => ticket.status !== 'resolved').length;
  const linkedCount = tickets.filter((ticket) => ticket.conflict_id !== null).length;
  const missingStudentCount = tickets.filter((ticket) => ticket.student_ref === null).length;

  return (
    <Accordion
      id="support-tickets-accordion"
      title={dashboardStory.tickets.title}
      headingId="tickets-heading"
      descriptionId="tickets-description"
      defaultOpen={defaultOpen}
      className="panel-section"
      heading={
        <div className="section-heading">
          <div>
            <p className="eyebrow">{dashboardStory.tickets.step}</p>
            <h2 id="tickets-heading">{dashboardStory.tickets.title}</h2>
            <p id="tickets-description" className="section-description">{dashboardStory.tickets.description}</p>
          </div>
          <StatusBadge status="complete" label={`${tickets.length} extracted`} />
        </div>
      }
    >
      {tickets.length ? (
        <>
          <div className="ticket-summary" role="group" aria-label="Ticket triage summary">
            <div className="ticket-summary-card"><span>Needs review</span><strong>{openCount.toLocaleString('en-US')}</strong><small>open or pending tickets</small></div>
            <div className="ticket-summary-card"><span>Linked conflicts</span><strong>{linkedCount.toLocaleString('en-US')}</strong><small>can open invariant evidence</small></div>
            <div className="ticket-summary-card"><span>Missing student reference</span><strong>{missingStudentCount.toLocaleString('en-US')}</strong><small>check the source record manually</small></div>
          </div>

          <aside className="ticket-guide" aria-labelledby="ticket-guide-heading">
            <div>
              <p className="eyebrow">Triage guide</p>
              <h3 id="ticket-guide-heading">Move from request to evidence</h3>
            </div>
            <ol>
              <li>Start with the status and requested action.</li>
              <li>Confirm the student, family, system, and record references.</li>
              <li>Open the linked conflict to inspect lineage and make a guarded proposal decision.</li>
            </ol>
            <p className="ticket-guide-note">Review is read-only until a reviewer explicitly decides a proposal. Keystone never writes back to source systems.</p>
          </aside>

          <div className="table-scroll ticket-table" tabIndex={0} aria-label="Scrollable extracted support tickets">
          <table>
            <caption className="sr-only">Extracted support tickets with join references, requested action, and review status</caption>
            <thead>
              <tr>
                <th scope="col">Ticket / state</th>
                <th scope="col">Join references</th>
                <th scope="col">Source record</th>
                <th scope="col">Issue / request</th>
                <th scope="col">Owner / resolution</th>
                <th scope="col">Timeline</th>
                <th scope="col">Next step</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <th scope="row"><div className="cell-stack">
                    <StatusBadge status={ticket.status} />
                    <span className="mono muted">{ticket.id}</span>
                    <span className="ticket-metadata">Message {ticket.message_id}</span>
                  </div></th>
                  <td><div className="cell-stack">
                    <span className="ticket-field-label">Student</span>
                    <span className="mono">{ticket.student_ref ?? 'No reference extracted'}</span>
                    <span className="ticket-field-label">Family</span>
                    <span className="mono">{ticket.family_ref ?? 'Not recorded'}</span>
                  </div></td>
                  <td><div className="cell-stack">
                    <strong>{systemLabel(ticket.system)}</strong>
                    <span className="ticket-field-label">Record ID</span>
                    <span className="mono">{ticket.record_id ?? 'Not recorded'}</span>
                  </div></td>
                  <td><div className="cell-stack">
                    <span className="ticket-field-label">Issue type</span>
                    <strong>{humanize(ticket.issue_type)}</strong>
                    <span className="ticket-field-label">Requested action</span>
                    <strong>{actionLabel(ticket.requested_action)}</strong>
                    <span className="ticket-metadata mono">{ticket.requested_action}</span>
                  </div></td>
                  <td><div className="cell-stack">
                    <span><span className="ticket-field-label">Owner</span>{ticket.owner}</span>
                    <span><span className="ticket-field-label">Resolution</span>{ticket.resolution ? humanize(ticket.resolution) : 'Awaiting resolution'}</span>
                  </div></td>
                  <td><div className="cell-stack">
                    <span><span className="ticket-field-label">Opened</span><TicketDate value={ticket.opened_at} /></span>
                    <span><span className="ticket-field-label">Resolved</span><TicketDate value={ticket.resolved_at} /></span>
                  </div></td>
                  <td><div className="cell-stack">
                    {ticket.conflict_id && onConflict ? <button type="button" className="secondary-button" aria-label={`Review conflict for ${humanize(ticket.issue_type)}`} onClick={() => onConflict(ticket.conflict_id!)}>Review conflict</button> : null}
                    {ticket.conflict_id ? <span className="ticket-metadata">Conflict <span className="mono">{ticket.conflict_id}</span></span> : <span className="muted">No linked conflict; triage manually.</span>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : (
        <div className="empty-state compact-empty">
          <span aria-hidden="true">◷</span>
          <h3>No tickets in this evidence window</h3>
          <p>The stretch extraction has not produced any rows yet. Run the stretch extraction job, then refresh this page.</p>
        </div>
      )}
    </Accordion>
  );
}
