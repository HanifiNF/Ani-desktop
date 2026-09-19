import type { ReactNode } from "react";

/**
 * Content that opens and closes with its height animated. It stays mounted so closing can animate too;
 * while closed it is inert and hidden from assistive technology.
 */
export default function Reveal({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  return <div id={id} className="reveal" data-open={open} inert={!open} aria-hidden={!open}>
    <div className={className ? `reveal-inner ${className}` : "reveal-inner"}>{children}</div>
  </div>;
}
