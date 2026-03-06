import { describe, expect, it } from "vitest";
import { basename, formatTokens } from "./format";

describe("format helpers", () => {
  it("formats token counts predictably", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_300)).toBe("12.3K");
    expect(formatTokens(1_230_000, 1)).toBe("1.2M");
  });

  it("extracts the basename across path styles", () => {
    expect(basename("/tmp/demo/file.ts")).toBe("file.ts");
    expect(basename("C:\\temp\\demo\\file.ts")).toBe("file.ts");
  });
});
