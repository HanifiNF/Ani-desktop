import { useState, type ReactNode } from "react";

/**
 * Content that opens and closes with its height animated. It stays mounted so closing can animate too;
 * while closed it is inert and hidden from assistive technology. Once fully open it is marked settled, so styles can let
 * a dropdown or a focus ring reach past the edge that clips the content while it moves.
 */
export default function Reveal({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  const [settled, setSettled] = useState(open);
  if (!open && settled) setSettled(false);
  return <div id={id} className="reveal" data-open={open} data-settled={open && settled} inert={!open} aria-hidden={!open}
    onTransitionEnd={(event) => { if (open && event.target === event.currentTarget && event.propertyName === "grid-template-rows") setSettled(true); }}>
    <div className={className ? `reveal-inner ${className}` : "reveal-inner"}>{children}</div>
  </div>;
}
