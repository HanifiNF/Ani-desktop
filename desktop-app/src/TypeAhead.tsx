import { useId, useState } from "react";

export interface TypeAheadOption { key: string; label: string; note?: string; disabled?: boolean }

/** A short field that lists matches under itself as you type; chosen values sit inside it as removable tokens. The owner supplies the matches. */
export default function TypeAhead({ label, tokens, term, options, pending, placeholder = "Any", onTerm, onPick, onRemove }: {
  label: string; tokens: string[]; term: string; options: TypeAheadOption[]; pending?: boolean; placeholder?: string;
  onTerm: (term: string) => void; onPick: (key: string) => void; onRemove: (token: string) => void;
}) {
  const [cursor, setCursor] = useState(0), [focused, setFocused] = useState(false), list = useId();
  const open = focused && term.trim().length > 0 && (options.length > 0 || !pending);
  const index = Math.min(cursor, Math.max(0, options.length - 1));
  const pick = (option?: TypeAheadOption) => { if (option && !option.disabled) { onPick(option.key); setCursor(0); } };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); if (options.length) setCursor((index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length); }
    else if (event.key === "Enter") { event.preventDefault(); pick(options[index]); }
    else if (event.key === "Escape" && term) { event.preventDefault(); event.stopPropagation(); onTerm(""); }
    else if (event.key === "Backspace" && !term && tokens.length) onRemove(tokens[tokens.length - 1]);
  };
  return <span className="typeahead">
    <span className="chips-lab">{label}</span>
    <span className="typeahead-anchor"><label className="typeahead-box">
      {tokens.map((token) => <span className="token" key={token}>{token}<button type="button" aria-label={`Remove ${token}`} onClick={() => onRemove(token)}>×</button></span>)}
      <input type="text" role="combobox" aria-label={label} aria-expanded={open} aria-controls={list} aria-autocomplete="list" maxLength={60} spellCheck={false} value={term} placeholder={tokens.length ? "" : placeholder}
        onChange={(event) => { onTerm(event.target.value); setCursor(0); }} onKeyDown={onKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
    </label>
    {open && <span className="typeahead-list" id={list} role="listbox" onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, position) => <button type="button" role="option" key={option.key} aria-selected={position === index} aria-disabled={option.disabled} className={position === index ? "on" : ""}
        onMouseEnter={() => setCursor(position)} onClick={() => pick(option)}>{option.label}{option.note && <small>{option.note}</small>}</button>)}
      {!options.length && <span className="typeahead-none">No match</span>}
    </span>}</span>
  </span>;
}
