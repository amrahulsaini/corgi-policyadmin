export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Corgi"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <g fill="#fff">
        <path d="M8.6 4.4 13.8 12.6 4.9 14.2Z" />
        <path d="M23.4 4.4 27.1 14.2 18.2 12.6Z" />
        <path d="M7.4 14.4C7.4 11.5 11.2 9.6 16 9.6s8.6 1.9 8.6 4.8v4.4c0 4.6-3.9 7.6-8.6 7.6s-8.6-3-8.6-7.6Z" />
      </g>
      <circle cx="12.4" cy="16.6" r="1.6" fill="var(--accent)" />
      <circle cx="19.6" cy="16.6" r="1.6" fill="var(--accent)" />
      <path d="M16 22.2c-1.5 0-2.6-.9-2.6-1.8 0-.7 1.2-1.1 2.6-1.1s2.6.4 2.6 1.1c0 .9-1.1 1.8-2.6 1.8Z" fill="var(--accent)" />
    </svg>
  );
}
