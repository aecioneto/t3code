import { describe, expect, it } from "vite-plus/test";
import { redactSecrets } from "./redact.ts";

describe("redactSecrets", () => {
  it("removes known key shapes", () => {
    const text = "use sk-abcdefghijklmnopqrstuvwxyz123456 e AKIAABCDEFGHIJKLMNOP agora";
    const out = redactSecrets(text);
    expect(out).not.toContain("sk-abcdef");
    expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(out).toContain("[REDACTED]");
  });

  it("keeps the variable name and drops its value", () => {
    expect(redactSecrets("DB_PASSWORD=hunter2hunter2\nAPP_ENV=local")).toBe(
      "DB_PASSWORD=[REDACTED]\nAPP_ENV=local",
    );
    expect(redactSecrets('{"api_key": "abc123def456ghi789"}')).toContain('"api_key": [REDACTED]');
  });

  it("removes credentials inside URLs and bearer headers", () => {
    expect(redactSecrets("postgres://user:s3cr3tpass@db.local/app")).not.toContain("s3cr3tpass");
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop1234")).not.toContain(
      "abcdefghijklmnop1234",
    );
  });

  it("removes long random tokens but not ordinary identifiers or paths", () => {
    expect(redactSecrets("token x9Fk2Lq8Zr4Vb7Nm1Tc5Wd3Hs6")).toContain("[REDACTED]");
    const plain = "app/Http/Controllers/ReportController.php e calculate_monthly_report_totals";
    expect(redactSecrets(plain)).toBe(plain);
  });

  it("redacts a private key block entirely", () => {
    const out = redactSecrets(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----\nfim",
    );
    expect(out).toBe("[REDACTED]\nfim");
  });
});
