import type { Participant } from "../../shared/types";

export default function ParticipantPicker({
  participants,
  value,
  query,
  onQueryChange,
  onChange
}: {
  participants: Participant[];
  value: string;
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (participantId: string) => void;
}) {
  const selectedParticipant = participants.find((participant) => String(participant.id) === value) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filteredParticipants = participants
    .filter((participant) => {
      if (!normalizedQuery) {
        return true;
      }

      return [participant.name, participant.memo].some((item) =>
        item.toLocaleLowerCase("ko-KR").includes(normalizedQuery)
      );
    })
    .slice(0, 8);

  function handleQueryChange(nextQuery: string) {
    onQueryChange(nextQuery);

    const exactParticipant = participants.find((participant) => participant.name === nextQuery.trim());
    onChange(exactParticipant ? String(exactParticipant.id) : "");
  }

  function selectParticipant(participant: Participant) {
    onChange(String(participant.id));
    onQueryChange(participant.name);
  }

  return (
    <div className="participant-picker">
      <label>
        참가자 이름
        <input
          type="search"
          value={query}
          placeholder="이름 검색"
          autoComplete="off"
          onChange={(event) => handleQueryChange(event.target.value)}
        />
      </label>
      <div className="participant-choice-list">
        {filteredParticipants.map((participant) => (
          <button
            className={`participant-choice ${selectedParticipant?.id === participant.id ? "active" : ""}`}
            type="button"
            key={participant.id}
            onClick={() => selectParticipant(participant)}
          >
            <span>{participant.name}</span>
            {participant.memo ? <em>{participant.memo}</em> : null}
          </button>
        ))}
        {filteredParticipants.length === 0 ? <p className="picker-empty">검색 결과 없음</p> : null}
      </div>
      {selectedParticipant ? <p className="picker-state">선택됨: {selectedParticipant.name}</p> : null}
    </div>
  );
}
