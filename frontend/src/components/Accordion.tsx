import { useState, type ReactNode } from 'react';

interface AccordionProps {
  id: string;
  title: string;
  headingId: string;
  descriptionId?: string;
  heading: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Accordion({
  id,
  title,
  headingId,
  descriptionId,
  heading,
  children,
  className = '',
  defaultOpen = false,
  open,
  onOpenChange
}: AccordionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const expanded = open ?? uncontrolledOpen;
  const panelId = `${id}-panel`;

  const toggle = () => {
    const next = !expanded;
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section aria-labelledby={headingId} aria-describedby={descriptionId} className={`accordion ${className}`.trim()}>
      <div className="accordion-header">
        <div className="accordion-heading">{heading}</div>
        <button
          type="button"
          className="accordion-toggle"
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          onClick={toggle}
        >
          <span className="accordion-icon" aria-hidden="true">{expanded ? '−' : '+'}</span>
        </button>
      </div>
      <div id={panelId} className="accordion-panel" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
