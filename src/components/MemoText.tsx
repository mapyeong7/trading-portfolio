import { useMemo, useState } from "react";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function linkifyLine(line: string, lineIndex: number) {
  const parts = line.split(URL_PATTERN);

  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={`${lineIndex}-${index}`} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }

    return <span key={`${lineIndex}-${index}`}>{part}</span>;
  });
}

export default function MemoText({ text, limit = 120 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const cleanText = text.trim();
  const isLong = cleanText.length > limit;
  const visibleText = !isLong || expanded ? cleanText : `${cleanText.slice(0, limit).trim()}...`;
  const lines = useMemo(() => visibleText.split(/\r?\n/), [visibleText]);

  if (!cleanText) {
    return <span className="muted">아이디어 없음</span>;
  }

  return (
    <div className="memo-text">
      {lines.map((line, index) => (
        <p key={index}>{linkifyLine(line, index)}</p>
      ))}
      {isLong ? (
        <button className="text-button" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "접기" : "펼치기"}
        </button>
      ) : null}
    </div>
  );
}
