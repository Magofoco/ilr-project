import { cn } from '@/lib/utils';

/**
 * Lightweight skeleton block. Use in place of spinners while data loads — it
 * gives users a sense of layout before content arrives, which feels more
 * polished than a centered spinner.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/70', className)}
      {...props}
    />
  );
}
