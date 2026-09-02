import { createContext, useContext, type ReactNode } from 'react';
import { Accordion } from './Accordion';

export const DashboardAccordionDefaultOpen = createContext(false);

interface DashboardSectionProps {
  id: string;
  headingId: string;
  descriptionId?: string;
  heading: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DashboardSection({
  id,
  headingId,
  descriptionId,
  heading,
  children,
  className = '',
  title = ({
    'overview-heading': 'Start with the evidence',
    'conflicts-heading': 'Find the conflicts',
    'groups-heading': 'See the bigger pattern',
    'queue-heading': 'Decide what to record',
    'tickets-heading': 'Add support context'
  } as Record<string, string>)[headingId] ?? 'Section details',
  defaultOpen,
  open,
  onOpenChange
}: DashboardSectionProps) {
  const inheritedDefaultOpen = useContext(DashboardAccordionDefaultOpen);
  const effectiveDefaultOpen = defaultOpen ?? inheritedDefaultOpen;
  return (
    <Accordion id={id.replace(/-section$/u, '-accordion')} title={title} headingId={headingId} {...(descriptionId === undefined ? {} : { descriptionId })} className={className} defaultOpen={effectiveDefaultOpen} {...(open === undefined ? {} : { open })} {...(onOpenChange === undefined ? {} : { onOpenChange })} heading={heading}>
      {children}
    </Accordion>
  );
}
