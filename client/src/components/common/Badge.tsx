interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'neon' | 'negative';
  className?: string;
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-border text-text-secondary',
    neon: 'bg-neon/15 text-neon',
    negative: 'bg-negative/15 text-negative',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
