const SYMBOLS: Record<string, string> = {
  complete: '✓',
  active: '!',
  pending: '◷',
  approved: '✓',
  applied: '✓',
  rejected: '×',
  held: '‖',
  oscillation_hold: '↺',
  partial: '△',
  failed: '×',
  unchecked: '?',
  resolved: '✓',
  low: '↓'
};

export function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase('en-US'));
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span aria-hidden="true" className="status-symbol">{SYMBOLS[status] ?? '•'}</span>
      {label ?? humanize(status)}
    </span>
  );
}
