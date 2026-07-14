export function DragHandle({ label }) {
  return (
    <span className="inline-flex items-center text-brand-burgundy/45" title={label}>
      <svg aria-hidden="true" viewBox="0 0 16 20" className="h-5 w-4" fill="currentColor">
        <circle cx="5" cy="4" r="1.5" />
        <circle cx="11" cy="4" r="1.5" />
        <circle cx="5" cy="10" r="1.5" />
        <circle cx="11" cy="10" r="1.5" />
        <circle cx="5" cy="16" r="1.5" />
        <circle cx="11" cy="16" r="1.5" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
