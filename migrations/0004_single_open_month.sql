UPDATE contest_months
SET status = 'finalized',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'open'
  AND id NOT IN (
    SELECT id
    FROM contest_months
    WHERE status = 'open'
    ORDER BY month DESC, id DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_months_single_open
ON contest_months(status)
WHERE status = 'open';
