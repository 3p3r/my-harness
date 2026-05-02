import { describe, it, expect } from "vitest";
import { PROVIDER_VERSION } from "../index";

describe("Setup", () => {
  it("should have a provider version", () => {
    expect(PROVIDER_VERSION).toBe("0.1.0");
  });
});
