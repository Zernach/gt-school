import { memo } from 'react';
import { StatusBadge } from './StatusBadge';

interface SiteHeaderProps {
  status: string;
  label: string;
}

/** Memoized so dashboard and onboarding state cannot re-render the sticky shell. */
export const SiteHeader = memo(function SiteHeader({ status, label }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <img className="gt-school-logo" src="/gt-school-logo.png" alt="GT School" />
      <div><p>Reconciliation trust layer</p><h1>Keystone</h1></div>
      <div className="header-state"><StatusBadge status={status} label={label} /></div>
    </header>
  );
});
