import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'ghost';
};

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
  compact?: boolean;
};

export function Card({ children, className = '', tone = 'default' }: { children: ReactNode; className?: string; tone?: 'default' | 'soft' }) {
  return <div className={`ui-card ${tone} ${className}`.trim()}>{children}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="ui-pill">{children}</span>;
}

export function Button({ children, variant = 'solid', className = '', ...rest }: ButtonProps) {
  return (
    <button className={`ui-button ${variant} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, value, onChange, placeholder, type = 'text', compact = false }: FieldProps) {
  return (
    <label className={`ui-field ${compact ? 'compact' : ''}`.trim()}>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
