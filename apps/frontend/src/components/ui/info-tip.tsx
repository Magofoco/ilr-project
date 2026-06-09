import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GLOSSARY, type GlossaryKey } from '@/lib/glossary';
import { cn } from '@/lib/utils';

/**
 * Small "?" affordance you can drop next to any jargon to reveal a plain-
 * English definition from the central glossary. Keyboard- and screen-reader
 * accessible via Radix Tooltip.
 *
 * Pass either `term` (preferred — points at glossary key) or `label` + `text`
 * for ad-hoc one-offs.
 */
export interface InfoTipProps {
  /** Glossary key. If provided, definition is read from `lib/glossary.ts`. */
  term?: GlossaryKey;
  /** Ad-hoc label override (used when term is omitted). */
  label?: string;
  /** Ad-hoc body override. */
  text?: string;
  className?: string;
}

export function InfoTip({ term, label, text, className }: InfoTipProps) {
  const entry = term ? GLOSSARY[term] : undefined;
  const heading = label ?? entry?.term ?? '';
  const short = entry?.short;
  const long = text ?? entry?.long ?? '';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={heading ? `What is ${heading}?` : 'More info'}
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {heading && (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {heading}
          </p>
        )}
        {short && <p className="mt-0.5 font-medium text-foreground">{short}</p>}
        {long && (
          <p className="mt-1 text-muted-foreground">{long}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
