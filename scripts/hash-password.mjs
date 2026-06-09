import { pbkdf2Sync, randomBytes } from "node:crypto";

const [, , username, password, displayName = username] = process.argv;

if (!username || !password) {
  console.error("Usage: npm run account:sql -- <username> <password> [displayName]");
  process.exit(1);
}

const iterations = 100_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const passwordHash = [
  "pbkdf2_sha256",
  String(iterations),
  salt.toString("base64"),
  hash.toString("base64")
].join("$");

const escapeSql = (value) => value.replaceAll("'", "''");

console.log(
  `INSERT INTO accounts (username, display_name, password_hash) VALUES ('${escapeSql(
    username
  )}', '${escapeSql(displayName)}', '${passwordHash}') ON CONFLICT(username) DO UPDATE SET display_name = excluded.display_name, password_hash = excluded.password_hash, updated_at = CURRENT_TIMESTAMP;`
);
