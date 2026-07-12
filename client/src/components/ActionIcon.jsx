const iconPaths = {
  view: (
    <>
      <path d="M2.1 12s3.6-6 9.9-6 9.9 6 9.9 6-3.6 6-9.9 6-9.9-6-9.9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  open: (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
      <path d="M19 13v6H5V5h6" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  delete: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6 18 20H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </>
  ),
  activate: (
    <>
      <path d="m5 12 4 4L19 6" />
      <path d="M21 12a9 9 0 1 1-5.3-8.2" />
    </>
  ),
  deactivate: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.7 5.7 18.3 18.3" />
    </>
  ),
  approve: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  cancel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </>
  ),
  paid: (
    <>
      <path d="M12 3v18" />
      <path d="M17 7.5c-.8-1-2.3-1.5-4.1-1.5-2.3 0-3.9 1-3.9 2.7 0 4 8 1.8 8 6.2 0 1.9-1.8 3.1-4.4 3.1-2.1 0-3.8-.7-4.8-2" />
    </>
  ),
  password: (
    <>
      <path d="M15 7a4 4 0 1 0-3 6.9" />
      <path d="M12 14 4 22" />
      <path d="m7 19 2 2" />
      <path d="m10 16 2 2" />
    </>
  ),
  adjust: (
    <>
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v6h6" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

const toneClasses = {
  default: 'text-brand-burgundy hover:bg-brand-cream-dark/70',
  muted: 'text-brand-burgundy/65 hover:bg-brand-cream-dark/70',
  success: 'text-green-700 hover:bg-green-50',
  warning: 'text-brand-gold-dark hover:bg-brand-cream-dark/70',
  danger: 'text-red-700 hover:bg-red-50',
};

function Icon({ name }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name] || iconPaths.open}
    </svg>
  );
}

export function ActionIconButton({ icon, label, tone = 'default', className = '', ...props }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses[tone] || toneClasses.default} ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}

export function ActionIconLink({ as: Component = 'a', icon, label, tone = 'default', className = '', ...props }) {
  return (
    <Component
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2 focus:ring-offset-white ${toneClasses[tone] || toneClasses.default} ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </Component>
  );
}
