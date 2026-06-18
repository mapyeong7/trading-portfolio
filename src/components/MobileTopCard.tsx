import { formatPercent, returnClass } from "../lib/format";
import AppIcon from "./AppIcon";

type MobileTopItem = {
  rank: number;
  participantName: string;
  [key: string]: unknown;
};

export default function MobileTopCard({
  title,
  icon,
  variant,
  items,
  valueKey
}: {
  title: string;
  icon: "calendar" | "trend";
  variant: "monthly" | "cumulative";
  items: MobileTopItem[];
  valueKey: string;
}) {
  return (
    <article className={`mobile-top-card ${variant}`}>
      <div className="mobile-top-heading">
        <AppIcon name={icon} />
        <h3>{title}</h3>
      </div>
      <ol>
        {items.map((item) => (
          <li key={`${title}-${item.rank}-${item.participantName}`}>
            <strong>{item.rank}</strong>
            <span>{item.participantName}</span>
            <em className={returnClass(Number(item[valueKey]))}>{formatPercent(Number(item[valueKey]))}</em>
          </li>
        ))}
      </ol>
      {items.length === 0 ? <p>순위 데이터가 없습니다.</p> : null}
    </article>
  );
}
