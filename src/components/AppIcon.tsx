export type AppIconName =
  | "accounts"
  | "admin"
  | "calendar"
  | "cumulative"
  | "dashboard"
  | "entries"
  | "monthly"
  | "months"
  | "more"
  | "participants"
  | "quotes"
  | "refresh"
  | "trend"
  | "user";

export default function AppIcon({ name }: { name: AppIconName }) {
  if (name === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4h6v7H4zM14 4h6v7h-6zM4 15h6v5H4zM14 15h6v5h-6z" />
      </svg>
    );
  }

  if (name === "quotes" || name === "trend" || name === "cumulative") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 17l5-5 4 4 7-9" />
        <path d="M15 7h5v5" />
      </svg>
    );
  }

  if (name === "monthly" || name === "calendar" || name === "months") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v4M17 3v4M4 8h16M5 5h14v15H5z" />
        <path d="M8 12h2M12 12h2M16 12h2M8 16h2M12 16h2" />
      </svg>
    );
  }

  if (name === "entries") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5h14v5H5zM5 14h14v5H5z" />
        <path d="M8 10v4M16 10v4" />
      </svg>
    );
  }

  if (name === "admin" || name === "accounts") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.5-2.8 7.9-7 10-4.2-2.1-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-5" />
      </svg>
    );
  }

  if (name === "participants" || name === "user") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
        <path d="M16 8.5a2.5 2.5 0 1 0 0-5" />
        <path d="M17 14.5a4.5 4.5 0 0 1 3.5 4.4" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 12a8 8 0 0 1-14.2 5" />
        <path d="M4 17h5v5" />
        <path d="M4 12a8 8 0 0 1 14.2-5" />
        <path d="M20 7h-5V2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.5v.1M12 12v.1M12 18.5v.1" />
    </svg>
  );
}
