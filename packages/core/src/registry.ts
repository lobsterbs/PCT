import type { TestDefinition } from "./types.js";

export const TEST_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*\.\d{3}$/;

export class TestRegistry {
  readonly #tests = new Map<string, TestDefinition>();

  register(def: TestDefinition): void {
    validateDefinition(def);
    if (this.#tests.has(def.id)) {
      throw new Error(`Duplicate test id: ${def.id}`);
    }
    this.#tests.set(def.id, def);
  }

  get(id: string): TestDefinition | undefined {
    return this.#tests.get(id);
  }

  /** All definitions sorted by id, so output order never depends on registration order. */
  list(): TestDefinition[] {
    return [...this.#tests.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get size(): number {
    return this.#tests.size;
  }
}

export function validateDefinition(def: TestDefinition): void {
  if (!TEST_ID_PATTERN.test(def.id)) {
    throw new Error(`Invalid test id "${def.id}": expected <family>.<name>.<NNN>`);
  }
  if (!Number.isInteger(def.revision) || def.revision < 1) {
    throw new Error(`Test "${def.id}" revision must be a positive integer`);
  }
  if (def.partialCredit !== undefined && (def.partialCredit < 0 || def.partialCredit > 1)) {
    throw new Error(`Test "${def.id}" partialCredit must be between 0 and 1`);
  }
  if (def.description.trim().length === 0) {
    throw new Error(`Test "${def.id}" needs a description`);
  }
}
