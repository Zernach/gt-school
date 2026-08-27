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
}

export function Accordion({
  id,
  title,
  headingId,
  descriptionId,
  heading,
  children,
  className = '',
  defaultOpen = false
}: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${id}-panel`;

  return (
    <section aria-labelledby={headingId} aria-describedby={descriptionId} className={`accordion ${className}`.trim()}>
      <div className="accordion-header">
        <div className="accordion-heading">{heading}</div>
        <button
          type="button"
          className="accordion-toggle"
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="accordion-icon" aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </div>
      <div id={panelId} className="accordion-panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
