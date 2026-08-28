import type { ReactNode } from 'react';

interface DashboardSectionProps {
  id: string;
  headingId: string;
  descriptionId?: string;
  heading: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DashboardSection({
  id,
  headingId,
  descriptionId,
  heading,
  children,
  className = ''
}: DashboardSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className={`dashboard-section ${className}`.trim()}
    >
      {heading}
      <div className="section-content">{children}</div>
    </section>
  );
}
